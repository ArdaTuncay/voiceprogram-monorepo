defmodule Backend.WatchPartyTest do
  use ExUnit.Case, async: true

  alias Backend.WatchParty

  describe "parse_source/1" do
    test "accepts every common YouTube link shape" do
      for url <- [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "  https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ  "
          ] do
        assert WatchParty.parse_source(url) == {:ok, %{kind: "youtube", id: "dQw4w9WgXcQ"}},
               "expected #{inspect(url)} to parse"
      end
    end

    test "rejects YouTube links without a valid video id" do
      for url <- [
            "https://www.youtube.com/",
            "https://www.youtube.com/watch",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>",
            "https://youtu.be/",
            "https://www.youtube.com/@somechannel"
          ] do
        assert WatchParty.parse_source(url) == {:error, :invalid_url}, inspect(url)
      end
    end

    test "accepts a direct https link as a plain video url" do
      assert WatchParty.parse_source("https://Cdn.Example.com/films/a.mp4?x=1") ==
               {:ok, %{kind: "url", url: "https://cdn.example.com/films/a.mp4?x=1"}}
    end

    test "rejects anything that isn't a usable https link" do
      for input <- [
            "",
            "   ",
            "not a url",
            "http://example.com/a.mp4",
            "javascript:alert(1)",
            "data:video/mp4;base64,AAAA",
            "file:///etc/passwd",
            "https://user:pass@example.com/a.mp4",
            "https://example.com/" <> String.duplicate("a", 2100),
            nil,
            123
          ] do
        assert WatchParty.parse_source(input) == {:error, :invalid_url}, inspect(input)
      end
    end
  end

  describe "rooms" do
    setup do
      %{room_id: Ecto.UUID.generate()}
    end

    defp participant do
      spawn(fn -> Process.sleep(:infinity) end)
    end

    test "a new room starts empty", %{room_id: room_id} do
      assert WatchParty.join(room_id, participant()) == %{rev: 0, video: nil}
    end

    test "load, play, pause and seek update the shared state in order", %{room_id: room_id} do
      WatchParty.join(room_id, participant())
      source = %{kind: "youtube", id: "dQw4w9WgXcQ"}

      assert {:ok, %{rev: 1, video: %{source: ^source, playing: false, position: +0.0}}} =
               WatchParty.apply_action(room_id, "u1", {:load, source})

      assert {:ok, %{rev: 2, video: %{playing: true, position: 12.5, updated_by: "u2"}}} =
               WatchParty.apply_action(room_id, "u2", {:play, 12.5})

      assert {:ok, %{rev: 3, video: %{playing: true, position: 60.0}}} =
               WatchParty.apply_action(room_id, "u1", {:seek, 60})

      assert {:ok, %{rev: 4, video: %{playing: false, position: 61.0}}} =
               WatchParty.apply_action(room_id, "u1", {:pause, 61})

      assert {:ok, %{rev: 5, video: nil}} = WatchParty.apply_action(room_id, "u1", :clear)
    end

    test "a late joiner gets the current state", %{room_id: room_id} do
      WatchParty.join(room_id, participant())
      WatchParty.apply_action(room_id, "u1", {:load, %{kind: "url", url: "https://x.test/a.mp4"}})
      WatchParty.apply_action(room_id, "u1", {:play, 5})

      assert %{rev: 2, video: %{playing: true, position: 5.0, updated_at: updated_at}} =
               WatchParty.join(room_id, participant())

      assert_in_delta updated_at, System.system_time(:millisecond), 1_000
    end

    test "play/pause/seek need a loaded video", %{room_id: room_id} do
      WatchParty.join(room_id, participant())
      assert WatchParty.apply_action(room_id, "u1", {:play, 0}) == {:error, :no_video}
    end

    test "positions are clamped to a sane range", %{room_id: room_id} do
      WatchParty.join(room_id, participant())
      WatchParty.apply_action(room_id, "u1", {:load, %{kind: "youtube", id: "dQw4w9WgXcQ"}})

      assert {:ok, %{video: %{position: +0.0}}} =
               WatchParty.apply_action(room_id, "u1", {:seek, -30})

      assert {:ok, %{video: %{position: 86_400.0}}} =
               WatchParty.apply_action(room_id, "u1", {:seek, 1.0e12})
    end

    test "every change is broadcast on the room's topic", %{room_id: room_id} do
      BackendWeb.Endpoint.subscribe(WatchParty.topic(room_id))
      WatchParty.join(room_id, participant())
      WatchParty.apply_action(room_id, "u1", {:load, %{kind: "youtube", id: "dQw4w9WgXcQ"}})

      assert_receive %Phoenix.Socket.Broadcast{event: "state", payload: %{rev: 1, video: %{}}}
    end

    test "the room stops once its last participant is gone", %{room_id: room_id} do
      p = participant()
      WatchParty.join(room_id, p)
      WatchParty.apply_action(room_id, "u1", {:load, %{kind: "youtube", id: "dQw4w9WgXcQ"}})
      [{room, _}] = Registry.lookup(Backend.WatchParty.Registry, room_id)
      ref = Process.monitor(room)

      Process.exit(p, :kill)

      assert_receive {:DOWN, ^ref, :process, ^room, :normal}, 1_000
      assert WatchParty.join(room_id, participant()) == %{rev: 0, video: nil}
    end
  end
end
