# Script for populating the database. You can run it as:
#
#     mix run priv/repo/seeds.exs
#
# Inside the script, you can read and write to any of your
# repositories directly:
#
#     Backend.Repo.insert!(%Backend.SomeSchema{})
#
# We recommend using the bang functions (`insert!`, `update!`
# and so on) as they will fail if something goes wrong.

import Ecto.Query

alias Backend.Repo
alias Backend.Accounts.User
alias Backend.Chat.{Channel, Message}
alias Backend.Servers.{Server, ServerMember}

# Every user needs at least one server to land in. There's no invite-link
# flow yet, so newly registered users start with zero servers until they
# create their own — this seed only exists to give pre-existing test
# accounts (from before servers existed) a home instead of an empty app.
main_server =
  case Repo.get_by(Server, name: "Ana Sunucu") do
    nil ->
      case Repo.one(from u in User, order_by: [asc: u.inserted_at], limit: 1) do
        nil ->
          nil

        owner ->
          %Server{}
          |> Server.changeset(%{name: "Ana Sunucu", owner_id: owner.id})
          |> Repo.insert!()
      end

    server ->
      server
  end

if main_server do
  # Adopt any pre-existing channels (from before servers existed) into the
  # main server, preserving their message history.
  from(c in Channel, where: is_nil(c.server_id))
  |> Repo.update_all(set: [server_id: main_server.id])

  # Backfill: make sure every existing user is a member of the main server.
  Repo.all(User)
  |> Enum.each(fn user ->
    unless Repo.get_by(ServerMember, server_id: main_server.id, user_id: user.id) do
      role = if user.id == main_server.owner_id, do: "owner", else: "member"

      %ServerMember{}
      |> ServerMember.changeset(%{server_id: main_server.id, user_id: user.id, role: role})
      |> Repo.insert!()
    end
  end)

  default_text_channels = ["genel", "oyun", "kodlama"]

  Enum.each(default_text_channels, fn name ->
    unless Repo.get_by(Channel, server_id: main_server.id, name: name) do
      %Channel{}
      |> Channel.changeset(%{name: name, type: "text", server_id: main_server.id})
      |> Repo.insert!()
    end
  end)

  default_voice_channels = ["Ses Kanalı 1", "Ses Kanalı 2"]

  Enum.each(default_voice_channels, fn name ->
    unless Repo.get_by(Channel, server_id: main_server.id, name: name) do
      %Channel{}
      |> Channel.changeset(%{name: name, type: "voice", server_id: main_server.id})
      |> Repo.insert!()
    end
  end)

  # Backfill any pre-existing messages (from before channels existed) into #genel.
  genel = Repo.get_by!(Channel, server_id: main_server.id, name: "genel")

  from(m in Message, where: is_nil(m.channel_id))
  |> Repo.update_all(set: [channel_id: genel.id])
end
