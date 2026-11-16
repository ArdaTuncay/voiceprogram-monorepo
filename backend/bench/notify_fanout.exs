# How long notifying a server's members of one new message takes, by server
# size — the work BackendWeb.ChatChannel does for every message (see its
# notify_other_members/3). Compares the old way (look the members up, then
# broadcast to each one's "user:<id>" topic) with the current one (a single
# broadcast to the server's notifications topic, which every member's
# UserChannel listens on — Servers.broadcast_new_message/2).
#
#     cd backend && mix run bench/notify_fanout.exs
#
# Runs against the dev database: creates throwaway users and a server, and
# deletes them at the end. A fifth of the members are "online": a process
# subscribed to their personal "user:<id>" topic, as their UserChannel would
# be. Times are the median of 15 rounds, until every online subscriber has
# the message.

Logger.configure(level: :warning)

alias Backend.Repo
alias Backend.Servers

defmodule Bench do
  def median(fun, rounds \\ 15) do
    times = for _ <- 1..rounds, do: fun |> :timer.tc() |> elem(0)
    times |> Enum.sort() |> Enum.at(div(rounds, 2))
  end

  def subscriber(topic, parent) do
    spawn_link(fn ->
      Phoenix.PubSub.subscribe(Backend.PubSub, topic)
      send(parent, :subscribed)
      loop(parent)
    end)
  end

  defp loop(parent) do
    receive do
      %Phoenix.Socket.Broadcast{} ->
        send(parent, :got)
        loop(parent)

      {:new_message, _payload} ->
        send(parent, :got)
        loop(parent)

      :stop ->
        :ok
    end
  end

  def await(0), do: :ok

  def await(n) do
    receive do
      :got -> await(n - 1)
    after
      5_000 -> raise "timed out with #{n} subscribers left"
    end
  end

  def ms(us), do: :erlang.float_to_binary(us / 1000, decimals: 2) <> " ms"
end

now = DateTime.utc_now(:second)
now_usec = DateTime.utc_now()
run = System.unique_integer([:positive])

for members <- [100, 1_000, 5_000] do
  users =
    for i <- 1..members do
      %{
        id: Ecto.UUID.generate(),
        username: "bench#{run}_#{members}_#{i}",
        email: "bench#{run}_#{members}_#{i}@bench.invalid",
        password_hash: "x",
        inserted_at: now,
        updated_at: now
      }
    end

  users
  |> Enum.chunk_every(1_000)
  |> Enum.each(
    &Repo.insert_all("users", Enum.map(&1, fn u -> %{u | id: Ecto.UUID.dump!(u.id)} end))
  )

  [owner | _] = users
  server_id = Ecto.UUID.generate()

  Repo.insert_all("servers", [
    %{
      id: Ecto.UUID.dump!(server_id),
      name: "bench",
      owner_id: Ecto.UUID.dump!(owner.id),
      inserted_at: now,
      updated_at: now
    }
  ])

  users
  |> Enum.map(fn u ->
    %{
      id: Ecto.UUID.dump!(Ecto.UUID.generate()),
      server_id: Ecto.UUID.dump!(server_id),
      user_id: Ecto.UUID.dump!(u.id),
      role: "member",
      inserted_at: now_usec,
      updated_at: now_usec
    }
  end)
  |> Enum.chunk_every(1_000)
  |> Enum.each(&Repo.insert_all("server_members", &1))

  online = users |> Enum.take_every(5) |> Enum.map(& &1.id)
  parent = self()
  per_user = Enum.map(online, &Bench.subscriber("user:#{&1}", parent))

  shared =
    Enum.map(online, fn _ -> Bench.subscriber(Servers.notifications_topic(server_id), parent) end)

  for _ <- 1..(length(per_user) + length(shared)), do: receive(do: (:subscribed -> :ok))

  payload = %{id: Ecto.UUID.generate(), content: String.duplicate("x", 200), username: "ard"}

  query = Bench.median(fn -> Servers.list_member_user_ids(server_id) end)

  one_per_member =
    Bench.median(fn ->
      server_id
      |> Servers.list_member_user_ids()
      |> Enum.each(&BackendWeb.Endpoint.broadcast("user:#{&1}", "new_message", payload))

      Bench.await(length(online))
    end)

  one_shared =
    Bench.median(fn ->
      Servers.broadcast_new_message(server_id, payload)
      Bench.await(length(online))
    end)

  IO.puts(
    "#{members} members, #{length(online)} online:  " <>
      "member query #{Bench.ms(query)} | " <>
      "before (query + broadcast per member) #{Bench.ms(one_per_member)} | " <>
      "now (one broadcast to the server) #{Bench.ms(one_shared)}"
  )

  Enum.each(per_user ++ shared, &send(&1, :stop))
  Repo.query!("DELETE FROM servers WHERE id = $1", [Ecto.UUID.dump!(server_id)])

  Repo.query!("DELETE FROM users WHERE id = ANY($1)", [
    Enum.map(users, &Ecto.UUID.dump!(&1.id))
  ])
end
