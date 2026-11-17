defmodule Backend.WatchParty do
  @moduledoc """
  Watching a video together inside a voice room ("Birlikte izle").

  Nobody's video is streamed through us: every participant plays the same
  YouTube video or direct link in their own player, and only the playback
  state — what is loaded, whether it's playing, and from which second — is
  shared. One `Backend.WatchParty.Room` process per voice room holds that
  state and is the single authority on it; `BackendWeb.WatchChannel`
  forwards each participant's play/pause/seek to it, and it broadcasts the
  result to `"watch:<room_id>"` (see `topic/1`).

  The position is stored as "`position` seconds at server time
  `updated_at`" — while playing, a client computes where the video should
  be now as `position + (server_now - updated_at) / 1000`, so a late joiner
  lands on the same second as everyone else without anyone sending ticks.

  State lives only in memory: when the last participant leaves, the room
  process stops (after a short grace period so a reconnect keeps it).
  """

  alias Backend.WatchParty.Room

  @max_url_length 2048
  @youtube_hosts ~w(youtube.com www.youtube.com m.youtube.com music.youtube.com youtube-nocookie.com www.youtube-nocookie.com)
  @youtube_id ~r/\A[A-Za-z0-9_-]{11}\z/
  @youtube_path_prefixes ~w(shorts embed live v)

  @doc "The PubSub topic a room's state is broadcast on."
  def topic(room_id), do: "watch:#{room_id}"

  @doc """
  Registers `pid` (a `BackendWeb.WatchChannel` process) as a participant of
  `room_id`'s watch party, starting the room if needed, and returns its
  current public state.
  """
  def join(room_id, pid) do
    with_room(room_id, &Room.join(&1, pid))
  end

  @doc """
  Applies one participant's action to the room and broadcasts the new state.

  Actions: `{:load, source}`, `{:play, position}`, `{:pause, position}`,
  `{:seek, position}`, `:clear`. Returns `{:ok, state}` or
  `{:error, :no_video}` for a play/pause/seek with nothing loaded.
  """
  def apply_action(room_id, user_id, action) do
    with_room(room_id, &Room.apply_action(&1, user_id, action))
  end

  # A room can stop between the Registry lookup and the call (its grace
  # timer fired just then); the call then exits with :noproc/:normal and a
  # fresh room is started on the retry.
  defp with_room(room_id, fun, attempts \\ 2) do
    fun.(ensure_room(room_id))
  catch
    :exit, _reason when attempts > 1 -> with_room(room_id, fun, attempts - 1)
  end

  defp ensure_room(room_id) do
    case Registry.lookup(Backend.WatchParty.Registry, room_id) do
      [{pid, _}] ->
        pid

      [] ->
        case DynamicSupervisor.start_child(Backend.WatchParty.Supervisor, {Room, room_id}) do
          {:ok, pid} -> pid
          {:error, {:already_started, pid}} -> pid
        end
    end
  end

  @doc """
  Parses what a participant pasted into a playable source:

    * any common YouTube link (watch, youtu.be, shorts, embed, live,
      music, nocookie) → `%{kind: "youtube", id: video_id}`
    * any other `https://` link → `%{kind: "url", url: url}`, played in a
      plain `<video>` element (mp4/webm, or whatever the browser handles)

  Plain `http://` is refused for direct links: the app is served over
  HTTPS, where the browser would block (or silently upgrade and break) it.
  """
  def parse_source(input) when is_binary(input) do
    input = String.trim(input)

    with true <- input != "" and byte_size(input) <= @max_url_length,
         %URI{scheme: scheme, host: host} = uri when is_binary(host) and host != "" <-
           URI.parse(input),
         true <- scheme in ["http", "https"],
         nil <- uri.userinfo do
      host = String.downcase(host)

      cond do
        host == "youtu.be" -> youtube_from_path(uri.path)
        host in @youtube_hosts -> youtube_from_uri(uri)
        scheme == "https" -> {:ok, %{kind: "url", url: URI.to_string(%{uri | host: host})}}
        true -> {:error, :invalid_url}
      end
    else
      _ -> {:error, :invalid_url}
    end
  end

  def parse_source(_), do: {:error, :invalid_url}

  defp youtube_from_uri(%URI{path: "/watch", query: query}) when is_binary(query) do
    query |> URI.decode_query() |> Map.get("v") |> youtube_id()
  end

  defp youtube_from_uri(%URI{path: path}) when is_binary(path) do
    case String.split(path, "/", trim: true) do
      [prefix, id | _] when prefix in @youtube_path_prefixes -> youtube_id(id)
      _ -> {:error, :invalid_url}
    end
  end

  defp youtube_from_uri(_), do: {:error, :invalid_url}

  defp youtube_from_path(path) when is_binary(path) do
    case String.split(path, "/", trim: true) do
      [id | _] -> youtube_id(id)
      _ -> {:error, :invalid_url}
    end
  end

  defp youtube_from_path(_), do: {:error, :invalid_url}

  defp youtube_id(id) when is_binary(id) do
    if Regex.match?(@youtube_id, id),
      do: {:ok, %{kind: "youtube", id: id}},
      else: {:error, :invalid_url}
  end

  defp youtube_id(_), do: {:error, :invalid_url}
end
