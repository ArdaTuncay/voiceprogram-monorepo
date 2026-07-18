defmodule Backend.DirectMessages do
  @moduledoc """
  One-on-one direct messages, layered on top of `Backend.Friends` — a DM
  room can only be opened between two accepted friends (see
  `open_room/2`), though an existing room and its history stay reachable
  even if the friendship is later removed (mirrors how real chat apps keep
  history around after an unfriend).
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts
  alias Backend.DirectMessages.{DmMessage, DmMessageReaction, DmRoom}
  alias Backend.Friends
  alias Backend.Repo

  @default_message_limit 50
  @search_limit 50

  @doc """
  Opens (or returns the existing) DM room between `user_id` and a target
  resolved from `attrs["user_id"]`. Requires an accepted friendship.

  Returns `{:ok, room}` or `{:error, reason}` where reason is one of
  `:user_not_found`, `:cannot_dm_self`, `:not_friends`, or an
  `Ecto.Changeset`.
  """
  def open_room(user_id, attrs) do
    with {:ok, target} <- resolve_target(attrs),
         :ok <- validate_not_self(user_id, target.id),
         :ok <- validate_friends(user_id, target.id),
         {:ok, room} <- get_or_create_room(user_id, target.id) do
      {:ok, Repo.preload(room, [:user_one, :user_two])}
    end
  end

  @doc """
  Lists every DM room `user_id` is part of, each shaped from their point of
  view (see `to_view/2`) — the other participant's id/username/status.
  """
  def list_rooms_for_user(user_id) do
    DmRoom
    |> where([r], r.user_one_id == ^user_id or r.user_two_id == ^user_id)
    |> Repo.all()
    |> Repo.preload([:user_one, :user_two])
    |> Enum.map(&to_view(&1, user_id))
  end

  @doc "Shapes a (preloaded) DM room from `viewer_id`'s point of view: who the *other* participant is."
  def to_view(%DmRoom{} = room, viewer_id) do
    other = if room.user_one_id == viewer_id, do: room.user_two, else: room.user_one
    %{id: room.id, user_id: other.id, username: other.username, user_status: other.status}
  end

  @doc "Fetches a DM room by id. Returns `nil` if not found or the id isn't a valid UUID."
  def get_room(id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} -> Repo.get(DmRoom, id)
      :error -> nil
    end
  end

  @doc "Returns true if `user_id` is one of the two participants in `room`."
  def member?(%DmRoom{} = room, user_id),
    do: room.user_one_id == user_id or room.user_two_id == user_id

  @doc """
  Returns a page of messages for a DM room, most recent first internally but
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
  def list_messages(room_id, opts \\ []) do
    limit = Keyword.get(opts, :limit, @default_message_limit)
    before_id = Keyword.get(opts, :before_id)

    DmMessage
    |> where([m], m.dm_room_id == ^room_id)
    |> apply_cursor(before_id, room_id)
    |> order_by([m], desc: m.seq)
    |> limit(^limit)
    |> preload(:user)
    |> Repo.all()
    |> Enum.reverse()
    |> attach_reactions()
  end

  @doc """
  Searches a DM room's messages, most recent match first, preloaded with
  their authors and grouped reactions — mirrors `Backend.Chat.search_messages/2`,
  scoped to a DM room instead of a channel. Not cursor-paginated (search
  results are a capped list). Returns at most #{@search_limit} matches.

  `filters` is a string-keyed map (as produced by Phoenix's controller
  params) supporting:
    * `"query"` — text to match against message content, case-insensitive
      and substring-based (`ILIKE`). Blank or absent skips this filter.
    * `"author_id"` — only messages sent by this user id.
    * `"has_file"` — when `true`/`"true"`, only messages with a non-null
      `file_url`.
  """
  def search_dm_messages(room_id, filters \\ %{}) do
    DmMessage
    |> where([m], m.dm_room_id == ^room_id)
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

  defp apply_cursor(query, nil, _room_id), do: query

  defp apply_cursor(query, before_id, room_id) do
    case Ecto.UUID.cast(before_id) do
      :error ->
        where(query, [m], false)

      {:ok, _} ->
        case Repo.get_by(DmMessage, id: before_id, dm_room_id: room_id) do
          nil -> where(query, [m], false)
          cursor -> where(query, [m], m.seq < ^cursor.seq)
        end
    end
  end

  @doc "Creates and persists a new DM message. Returns `{:ok, message}` or `{:error, changeset}`."
  def create_message(attrs) do
    %DmMessage{}
    |> DmMessage.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, message} -> {:ok, Repo.preload(message, :user)}
      error -> error
    end
  end

  @doc """
  Updates `dm_message_id`'s content on behalf of `attrs[:user_id]`, marking
  it as edited — mirrors `Backend.Chat.update_message/2`. Only the
  message's original author may edit it, and only if it still belongs to
  `attrs[:dm_room_id]`.

  Returns `{:ok, message}`, `{:error, :not_found}`,
  `{:error, :not_authorized}`, or `{:error, changeset}`.
  """
  def update_dm_message(
        dm_message_id,
        %{user_id: req_user_id, dm_room_id: req_dm_room_id} = attrs
      ) do
    case fetch_message(dm_message_id) do
      nil ->
        {:error, :not_found}

      %DmMessage{user_id: user_id, dm_room_id: dm_room_id}
      when user_id != req_user_id or dm_room_id != req_dm_room_id ->
        {:error, :not_authorized}

      message ->
        message
        |> DmMessage.edit_changeset(attrs)
        |> Repo.update()
        |> case do
          {:ok, updated} ->
            {:ok,
             updated
             |> Repo.preload(:user)
             |> Map.put(:reactions, list_reactions_for_message(dm_message_id))}

          error ->
            error
        end
    end
  end

  defp fetch_message(dm_message_id) do
    case Ecto.UUID.cast(dm_message_id) do
      {:ok, _} -> Repo.get(DmMessage, dm_message_id)
      :error -> nil
    end
  end

  @doc """
  Toggles `user_id`'s `emoji` reaction on `dm_message_id` — mirrors
  `Backend.Chat.toggle_reaction/4`, scoped to `room_id` instead of a channel
  so a client can't react to (and trigger a broadcast about) a message from
  a DM room it isn't a participant of.

  Returns `{:ok, grouped_reactions}` or `{:error, :message_not_found}`.
  """
  def toggle_reaction(dm_message_id, room_id, user_id, emoji) do
    case fetch_message_in_room(dm_message_id, room_id) do
      nil ->
        {:error, :message_not_found}

      _message ->
        toggle_reaction_row(dm_message_id, user_id, emoji)
        {:ok, list_reactions_for_message(dm_message_id)}
    end
  end

  defp fetch_message_in_room(dm_message_id, room_id) do
    case Ecto.UUID.cast(dm_message_id) do
      {:ok, _} -> Repo.get_by(DmMessage, id: dm_message_id, dm_room_id: room_id)
      :error -> nil
    end
  end

  defp toggle_reaction_row(dm_message_id, user_id, emoji) do
    case Repo.get_by(DmMessageReaction,
           dm_message_id: dm_message_id,
           user_id: user_id,
           emoji: emoji
         ) do
      nil ->
        %DmMessageReaction{}
        |> DmMessageReaction.changeset(%{
          dm_message_id: dm_message_id,
          user_id: user_id,
          emoji: emoji
        })
        |> Repo.insert()

      reaction ->
        Repo.delete(reaction)
    end
  end

  defp attach_reactions(messages) do
    reactions_by_message = list_reactions_by_message(Enum.map(messages, & &1.id))
    Enum.map(messages, &Map.put(&1, :reactions, Map.get(reactions_by_message, &1.id, [])))
  end

  defp list_reactions_for_message(dm_message_id) do
    DmMessageReaction
    |> where([r], r.dm_message_id == ^dm_message_id)
    |> Repo.all()
    |> group_reactions()
  end

  defp list_reactions_by_message(dm_message_ids) do
    DmMessageReaction
    |> where([r], r.dm_message_id in ^dm_message_ids)
    |> Repo.all()
    |> Enum.group_by(& &1.dm_message_id)
    |> Map.new(fn {dm_message_id, rows} -> {dm_message_id, group_reactions(rows)} end)
  end

  defp group_reactions(rows) do
    rows
    |> Enum.group_by(& &1.emoji)
    |> Enum.map(fn {emoji, rows} ->
      %{emoji: emoji, count: length(rows), user_ids: Enum.map(rows, & &1.user_id)}
    end)
    |> Enum.sort_by(& &1.emoji)
  end

  defp get_or_create_room(user_id, other_id) do
    {low, high} = canonical_pair(user_id, other_id)

    case Repo.get_by(DmRoom, user_one_id: low, user_two_id: high) do
      nil -> insert_room(low, high)
      room -> {:ok, room}
    end
  end

  defp insert_room(low, high) do
    case %DmRoom{} |> DmRoom.changeset(%{user_one_id: low, user_two_id: high}) |> Repo.insert() do
      {:ok, room} ->
        {:ok, room}

      {:error, changeset} ->
        # Lost a race against a concurrent open_room/2 for the same pair —
        # the other insert already won, so fetch what it created instead of
        # surfacing a spurious uniqueness error.
        if Keyword.has_key?(changeset.errors, :user_one_id) do
          {:ok, Repo.get_by!(DmRoom, user_one_id: low, user_two_id: high)}
        else
          {:error, changeset}
        end
    end
  end

  @doc "Sorts two user ids into a stable (low, high) order so the same pair always maps to one room."
  def canonical_pair(a, b) when a <= b, do: {a, b}
  def canonical_pair(a, b), do: {b, a}

  defp validate_friends(user_id, target_id) do
    if Friends.friends?(user_id, target_id), do: :ok, else: {:error, :not_friends}
  end

  defp validate_not_self(user_id, user_id), do: {:error, :cannot_dm_self}
  defp validate_not_self(_user_id, _target_id), do: :ok

  defp resolve_target(%{"user_id" => id}) when is_binary(id) and id != "" do
    case Accounts.get_user(id) do
      nil -> {:error, :user_not_found}
      user -> {:ok, user}
    end
  end

  defp resolve_target(_attrs), do: {:error, :user_not_found}
end
