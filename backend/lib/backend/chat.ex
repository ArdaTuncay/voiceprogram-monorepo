defmodule Backend.Chat do
  @moduledoc """
  Text/voice channels within a server, and the messages/reactions posted in
  them — the server-channel counterpart to `Backend.DirectMessages`.
  """

  import Ecto.Query, warn: false

  alias Backend.Chat.{Channel, Message, MessageReaction}
  alias Backend.Repo

  @default_message_limit 50
  @search_limit 50

  @doc "Returns all channels for a server, ordered by position (then name to break ties)."
  def list_channels_for_server(server_id) do
    Channel
    |> where([c], c.server_id == ^server_id)
    |> order_by([c], asc: c.position, asc: c.name)
    |> Repo.all()
  end

  @doc "Fetches a channel by id. Returns `nil` if not found or the id isn't a valid UUID."
  def get_channel(id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} -> Repo.get(Channel, id)
      :error -> nil
    end
  end

  @doc """
  Returns every voice channel's id, across every server — used by
  `Backend.Telemetry.PeriodicReporter` to know which `"voice:<id>"`
  Presence topics to query. `Phoenix.Tracker`/`Phoenix.Presence` has no
  "list every currently-active topic" API of its own (only `list/2`,
  which already requires knowing the topic) — combining this DB list with
  a `Backend.Presence.list/1` call per id is the only way to answer "how
  many voice channels currently have someone in them" without inventing
  a separate, redundant piece of state that would need to be kept in
  sync with Presence by hand.
  """
  def list_voice_channel_ids do
    Channel
    |> where([c], c.type == "voice")
    |> select([c], c.id)
    |> Repo.all()
  end

  @doc """
  Returns a page of messages for a channel, most recent first internally but
  returned in chronological (oldest → newest) order, preloaded with their
  authors and grouped reactions.

  Options:
    * `:limit` — page size, defaults to #{@default_message_limit}.
    * `:before_id` — when given, only returns messages older than the
      message with this id (for infinite-scroll pagination). Ordering is
      by `seq`, a DB-assigned monotonic sequence — not `inserted_at` (whose
      resolution isn't reliably fine enough to break ties between messages
      sent in rapid succession) and not `id` (a random UUID, unrelated to
      send order).
  """
  def list_messages(channel_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, @default_message_limit)
    before_id = Keyword.get(opts, :before_id)

    Message
    |> where([m], m.channel_id == ^channel_id)
    |> apply_cursor(before_id, channel_id)
    |> order_by([m], desc: m.seq)
    |> limit(^limit)
    |> preload(:user)
    |> Repo.all()
    |> Enum.reverse()
    |> attach_reactions()
  end

  @doc """
  Searches a channel's messages, most recent match first, preloaded with
  their authors and grouped reactions — same result shape as
  `list_messages/2`, but not cursor-paginated (search results are a capped
  list, not meant to be infinite-scrolled). Returns at most
  #{@search_limit} matches.

  `filters` is a string-keyed map (as produced by Phoenix's controller
  params) supporting:
    * `"query"` — text to match against message content, case-insensitive
      and substring-based (`ILIKE`). Blank or absent skips this filter.
    * `"author_id"` — only messages sent by this user id.
    * `"has_file"` — when `true`/`"true"`, only messages with a non-null
      `file_url`.
  """
  def search_messages(channel_id, filters \\ %{}) do
    Message
    |> where([m], m.channel_id == ^channel_id)
    |> apply_text_filter(Map.get(filters, "query"))
    |> apply_author_filter(Map.get(filters, "author_id"))
    |> apply_has_file_filter(Map.get(filters, "has_file"))
    |> order_by([m], desc: m.seq)
    |> limit(@search_limit)
    |> preload(:user)
    |> Repo.all()
    |> attach_reactions()
  end

  defp apply_text_filter(query, text) when text in [nil, ""], do: query

  defp apply_text_filter(query, text) do
    pattern = "%" <> escape_like(text) <> "%"
    where(query, [m], ilike(m.content, ^pattern))
  end

  defp apply_author_filter(query, author_id) when author_id in [nil, ""], do: query

  defp apply_author_filter(query, author_id) do
    case Ecto.UUID.cast(author_id) do
      {:ok, _} -> where(query, [m], m.user_id == ^author_id)
      :error -> where(query, [m], false)
    end
  end

  defp apply_has_file_filter(query, has_file) when has_file in [true, "true"],
    do: where(query, [m], not is_nil(m.file_url))

  defp apply_has_file_filter(query, _has_file), do: query

  # Escapes ILIKE's own wildcard characters in user-supplied search text so
  # e.g. a literal "%" or "_" in someone's search query is matched
  # literally instead of acting as a SQL wildcard.
  defp escape_like(text) do
    text
    |> String.replace("\\", "\\\\")
    |> String.replace("%", "\\%")
    |> String.replace("_", "\\_")
  end

  defp attach_reactions(messages) do
    reactions_by_message = list_reactions_by_message(Enum.map(messages, & &1.id))
    Enum.map(messages, &Map.put(&1, :reactions, Map.get(reactions_by_message, &1.id, [])))
  end

  defp apply_cursor(query, nil, _channel_id), do: query

  defp apply_cursor(query, before_id, channel_id) do
    case Ecto.UUID.cast(before_id) do
      :error ->
        where(query, [m], false)

      {:ok, _} ->
        case Repo.get_by(Message, id: before_id, channel_id: channel_id) do
          nil -> where(query, [m], false)
          cursor -> where(query, [m], m.seq < ^cursor.seq)
        end
    end
  end

  @doc "Creates and persists a new message. Returns `{:ok, message}` or `{:error, changeset}`."
  def create_message(attrs) do
    %Message{}
    |> Message.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, message} -> {:ok, Repo.preload(message, :user)}
      error -> error
    end
  end

  @doc """
  Updates `message_id`'s content on behalf of `attrs[:user_id]`, marking it
  as edited. Only the message's original author may edit it, and only if it
  still belongs to `attrs[:channel_id]` — same channel-scoping guard as
  `toggle_reaction/4`, so a client can't edit (and trigger a broadcast about)
  a message from a channel it was never authorized to join.

  Returns `{:ok, message}`, `{:error, :not_found}`,
  `{:error, :not_authorized}`, or `{:error, changeset}`.
  """
  def update_message(message_id, %{user_id: req_user_id, channel_id: req_channel_id} = attrs) do
    case fetch_message(message_id) do
      nil ->
        {:error, :not_found}

      %Message{user_id: user_id, channel_id: channel_id}
      when user_id != req_user_id or channel_id != req_channel_id ->
        {:error, :not_authorized}

      message ->
        message
        |> Message.edit_changeset(attrs)
        |> Repo.update()
        |> case do
          {:ok, updated} ->
            {:ok,
             updated
             |> Repo.preload(:user)
             |> Map.put(:reactions, list_reactions_for_message(message_id))}

          error ->
            error
        end
    end
  end

  defp fetch_message(message_id) do
    case Ecto.UUID.cast(message_id) do
      {:ok, _} -> Repo.get(Message, message_id)
      :error -> nil
    end
  end

  @doc """
  Toggles `user_id`'s `emoji` reaction on `message_id` (adds it if absent,
  removes it if present) — but only if the message actually belongs to
  `channel_id`, so a client can't attach a reaction to (and trigger a
  broadcast about) a message from a channel it was never authorized to join.

  Returns `{:ok, grouped_reactions}` on success, `{:error, :message_not_found}`
  if the message doesn't exist or isn't in that channel.
  """
  def toggle_reaction(message_id, channel_id, user_id, emoji) do
    case fetch_message_in_channel(message_id, channel_id) do
      nil ->
        {:error, :message_not_found}

      _message ->
        toggle_reaction_row(message_id, user_id, emoji)
        {:ok, list_reactions_for_message(message_id)}
    end
  end

  defp fetch_message_in_channel(message_id, channel_id) do
    case Ecto.UUID.cast(message_id) do
      {:ok, _} -> Repo.get_by(Message, id: message_id, channel_id: channel_id)
      :error -> nil
    end
  end

  defp toggle_reaction_row(message_id, user_id, emoji) do
    case Repo.get_by(MessageReaction, message_id: message_id, user_id: user_id, emoji: emoji) do
      nil ->
        %MessageReaction{}
        |> MessageReaction.changeset(%{message_id: message_id, user_id: user_id, emoji: emoji})
        |> Repo.insert()

      reaction ->
        Repo.delete(reaction)
    end
  end

  defp list_reactions_for_message(message_id) do
    MessageReaction
    |> where([r], r.message_id == ^message_id)
    |> Repo.all()
    |> group_reactions()
  end

  defp list_reactions_by_message(message_ids) do
    MessageReaction
    |> where([r], r.message_id in ^message_ids)
    |> Repo.all()
    |> Enum.group_by(& &1.message_id)
    |> Map.new(fn {message_id, rows} -> {message_id, group_reactions(rows)} end)
  end

  defp group_reactions(rows) do
    rows
    |> Enum.group_by(& &1.emoji)
    |> Enum.map(fn {emoji, rows} ->
      %{emoji: emoji, count: length(rows), user_ids: Enum.map(rows, & &1.user_id)}
    end)
    |> Enum.sort_by(& &1.emoji)
  end
end
