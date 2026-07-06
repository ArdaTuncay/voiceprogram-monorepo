defmodule Backend.Chat do
  import Ecto.Query, warn: false

  alias Backend.Repo
  alias Backend.Chat.{Message, Channel}

  @default_message_limit 50

  @doc "Returns all channels for a server, ordered by name."
  def list_channels_for_server(server_id) do
    Channel
    |> where([c], c.server_id == ^server_id)
    |> order_by([c], asc: c.name)
    |> Repo.all()
  end

  @doc "Fetches a channel by id. Returns `nil` if not found or the id isn't a valid UUID."
  def get_channel(id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} -> Repo.get(Channel, id)
      :error -> nil
    end
  end

  @doc "Returns the most recent messages for a channel, preloaded with their authors."
  def list_messages(channel_id, limit \\ @default_message_limit) do
    Message
    |> where([m], m.channel_id == ^channel_id)
    |> order_by([m], desc: m.inserted_at)
    |> limit(^limit)
    |> preload(:user)
    |> Repo.all()
    |> Enum.reverse()
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
end
