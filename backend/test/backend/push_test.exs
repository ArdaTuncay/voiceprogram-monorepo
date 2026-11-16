defmodule Backend.PushTest do
  @moduledoc """
  Web Push for a closed Zircle: who gets one (DMs, @mentions; only users
  with no open Zircle), what it says, and the subscription bookkeeping.
  Push services are stubbed through Req.Test; `Backend.PushBrowser`
  decrypts what they'd have received.
  """
  use BackendWeb.ChannelCase, async: true

  alias Backend.{Accounts, Presence, Push, PushBrowser}
  alias Backend.Push.Subscription

  # Every request a push service would get, sent to the test process.
  defp capture_pushes(status \\ 201) do
    test = self()

    Req.Test.stub(Backend.Push, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      send(test, {:push, conn, body})
      Plug.Conn.send_resp(conn, status, "")
    end)
  end

  defp subscribe(user, opts \\ []) do
    browser = PushBrowser.new()
    session_id = Keyword.get(opts, :session_id)
    locale = Keyword.get(opts, :locale, "tr")
    {:ok, _} = Push.subscribe(user.id, session_id, browser.attrs, locale)
    browser
  end

  defp received_payload(browser) do
    assert_received {:push, conn, body}

    assert conn.host <> conn.request_path ==
             String.replace_prefix(browser.endpoint, "https://", "")

    body |> PushBrowser.decrypt(browser) |> Jason.decode!()
  end

  defp dm_message(attrs \\ %{}) do
    Map.merge(
      %{kind: :dm, dm_room_id: "room-1", sender: "ard", content: "selam", file?: false},
      attrs
    )
  end

  describe "subscribe/4" do
    test "only takes the browsers' push services, over https, with well-formed keys" do
      user = user_fixture()
      good = PushBrowser.new().attrs

      for endpoint <- [
            "https://evil.example.com/push",
            "http://fcm.googleapis.com/fcm/send/x",
            "https://fcm.googleapis.com:8443/fcm/send/x",
            "https://fcm.googleapis.com.evil.example/x",
            "https://user@fcm.googleapis.com/x"
          ] do
        assert {:error, changeset} =
                 Push.subscribe(user.id, nil, %{good | "endpoint" => endpoint}, "tr")

        assert "is not a supported push service" in Backend.DataCase.errors_on(changeset).endpoint
      end

      assert {:error, _} = Push.subscribe(user.id, nil, %{good | "p256dh" => "short"}, "tr")
      assert {:error, _} = Push.subscribe(user.id, nil, %{good | "auth" => "!!"}, "tr")

      for host <- ~w(fcm.googleapis.com updates.push.services.mozilla.com
                     wns2-par02p.notify.windows.com web.push.apple.com) do
        assert {:ok, _} = Push.subscribe(user.id, nil, PushBrowser.new(host).attrs, "tr")
      end
    end

    test "a browser has one subscription: subscribing again, even as someone else, replaces it" do
      [ali, ayse] = [user_fixture(), user_fixture()]
      browser = PushBrowser.new()

      {:ok, _} = Push.subscribe(ali.id, nil, browser.attrs, "tr")
      {:ok, _} = Push.subscribe(ayse.id, nil, browser.attrs, "en")

      assert Push.list_subscriptions(ali.id) == []
      assert [%Subscription{locale: "en"}] = Push.list_subscriptions(ayse.id)
    end

    test "keeps the newest ten per user" do
      user = user_fixture()
      for _ <- 1..12, do: subscribe(user)

      assert length(Push.list_subscriptions(user.id)) == 10
    end

    test "signing the subscribing device out ends its subscription" do
      user = user_fixture()
      token = Accounts.generate_user_token(user)
      {:ok, _user, session_id} = Accounts.authenticate_session(token)
      subscribe(user, session_id: session_id)
      subscribe(user)

      :ok = Accounts.revoke_session(user, session_id)

      assert [%Subscription{session_id: nil}] = Push.list_subscriptions(user.id)
    end
  end

  describe "notify/2" do
    test "sends an encrypted, VAPID-signed push the browser can read" do
      capture_pushes()
      user = user_fixture()
      browser = subscribe(user)

      :ok = Push.notify(user.id, dm_message())

      assert_received {:push, conn, _body} = message
      send(self(), message)
      assert ["vapid t=" <> _] = Plug.Conn.get_req_header(conn, "authorization")
      # (No content-encoding check: Req's plug adapter strips that request
      # header before the stub sees it, after trying to decompress the body.)
      assert Plug.Conn.get_req_header(conn, "ttl") == ["86400"]

      assert received_payload(browser) == %{
               "title" => "ard",
               "body" => "selam",
               "tag" => "dm:room-1",
               "open" => "dm:room-1"
             }
    end

    test "says it in the language the browser subscribed in" do
      capture_pushes()
      user = user_fixture()
      tr = subscribe(user, locale: "tr")
      en = subscribe(user, locale: "en")

      :ok = Push.notify(user.id, dm_message(%{content: "", file?: true, sender: nil}))

      payloads =
        for _ <- 1..2 do
          assert_received {:push, conn, body}
          browser = if String.ends_with?(tr.endpoint, conn.request_path), do: tr, else: en
          {browser, body |> PushBrowser.decrypt(browser) |> Jason.decode!()}
        end
        |> Map.new()

      assert %{"title" => "Biri", "body" => "Bir dosya gönderdi"} = payloads[tr]
      assert %{"title" => "Someone", "body" => "Sent a file"} = payloads[en]
    end

    test "names the channel for a mention and shortens long messages" do
      capture_pushes()
      user = user_fixture()
      browser = subscribe(user, locale: "en")

      :ok =
        Push.notify(user.id, %{
          kind: :mention,
          server_id: "srv",
          channel_id: "chan",
          channel_name: "genel",
          sender: "ard",
          content: String.duplicate("a", 300),
          file?: false
        })

      payload = received_payload(browser)
      assert payload["title"] == "ard in #genel"
      assert payload["open"] == "channel:srv:chan"
      assert String.length(payload["body"]) == 140
      assert String.ends_with?(payload["body"], "…")
    end

    test "skips a user who has Zircle open — the open tab notifies them itself" do
      capture_pushes()
      user = user_fixture()
      subscribe(user)
      {:ok, _} = Presence.track(self(), "user:#{user.id}", user.id, %{})

      :ok = Push.notify(user.id, dm_message())

      refute_received {:push, _conn, _body}
    end

    test "forgets a subscription the push service says is gone" do
      capture_pushes(410)
      user = user_fixture()
      subscribe(user)

      :ok = Push.notify(user.id, dm_message())

      assert_received {:push, _conn, _body}
      assert Push.list_subscriptions(user.id) == []
    end
  end

  describe "from the channels" do
    setup do
      capture_pushes()
      :ok
    end

    test "a DM pushes to the other person" do
      [ali, ayse] = [user_fixture(), user_fixture()]
      room = dm_room_fixture(ali, ayse)
      browser = subscribe(ayse)

      {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(ali)})
      {:ok, _reply, socket} = subscribe_and_join(socket, "dm:#{room.id}", %{})
      Req.Test.allow(Backend.Push, self(), socket.channel_pid)

      ref = push(socket, "shout", %{"content" => "naber"})
      assert_reply ref, :ok

      assert %{"title" => title, "body" => "naber", "open" => open} = received_payload(browser)
      assert title == ali.username
      assert open == "dm:#{room.id}"
    end

    test "a channel message pushes only to the members it @mentions" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)
      [mentioned, other] = [user_fixture(), user_fixture()]
      add_member_fixture(server, mentioned)
      add_member_fixture(server, other)
      mentioned_browser = subscribe(mentioned)
      subscribe(other)
      subscribe(owner)

      {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
      {:ok, _reply, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})
      Req.Test.allow(Backend.Push, self(), socket.channel_pid)

      ref = push(socket, "shout", %{"content" => "hey @#{String.upcase(mentioned.username)} bak"})
      assert_reply ref, :ok

      assert %{"open" => open} = received_payload(mentioned_browser)
      assert open == "channel:#{server.id}:#{channel.id}"
      refute_received {:push, _conn, _body}

      ref = push(socket, "shout", %{"content" => "kimseye değil, mail@#{other.username}.com"})
      assert_reply ref, :ok
      refute_received {:push, _conn, _body}
    end
  end
end
