defmodule Backend.MessageAttachmentTest do
  @moduledoc """
  A message's `file_url` used to be any string the client sent, so a
  "shout" could embed an image from an attacker's server: every member
  who saw the message would load it, handing over their IP address, user
  agent and the moment they read it (a tracking pixel). Attachments now
  have to be files `Backend.Uploads` itself stored.
  """
  # :uploads config is global application env, overridden in one test.
  use Backend.DataCase, async: false

  alias Backend.{Chat, DirectMessages, Uploads}

  @own_local "/uploads/AbCdEfGhIjKlMnOpQrStUv.png"

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    other = user_fixture()

    %{owner: owner, channel: default_channel(server), room: dm_room_fixture(owner, other)}
  end

  defp channel_message(ctx, file_url, file_type \\ "image/png") do
    Chat.create_message(%{
      content: "ek",
      file_url: file_url,
      file_type: file_type,
      user_id: ctx.owner.id,
      channel_id: ctx.channel.id
    })
  end

  defp dm_message(ctx, file_url, file_type \\ "image/png") do
    DirectMessages.create_message(%{
      content: "ek",
      file_url: file_url,
      file_type: file_type,
      user_id: ctx.owner.id,
      dm_room_id: ctx.room.id
    })
  end

  for kind <- [:channel_message, :dm_message] do
    describe "#{kind}" do
      test "accepts a file this server stored", ctx do
        assert {:ok, message} = unquote(kind)(ctx, @own_local)
        assert message.file_url == @own_local
      end

      test "still accepts a text-only message", ctx do
        assert {:ok, _} = unquote(kind)(ctx, nil, nil)
      end

      for url <- [
            "https://tracker.example/pixel.png",
            "http://example.com/f.png",
            "//tracker.example/AbCdEfGhIjKlMnOpQrStUv.png",
            "/uploads/../../etc/passwd",
            "/uploads/AbCdEfGhIjKlMnOpQrStUv.svg",
            "/uploads/kisa.png",
            "/api/users/logout_all",
            "javascript:alert(1)",
            "data:image/png;base64,AAAA"
          ] do
        test "rejects #{url}", ctx do
          assert {:error, changeset} = unquote(kind)(ctx, unquote(url))
          assert %{file_url: [_ | _]} = errors_on(changeset)
        end
      end

      test "rejects a file type the upload endpoint never produces", ctx do
        assert {:error, changeset} = unquote(kind)(ctx, @own_local, "text/html")
        assert %{file_type: [_ | _]} = errors_on(changeset)
      end
    end
  end

  test "with S3 storage, accepts that bucket's public URLs and nothing else", ctx do
    previous = Application.get_env(:backend, :uploads)
    on_exit(fn -> Application.put_env(:backend, :uploads, previous) end)

    Application.put_env(:backend, :uploads,
      adapter: :s3,
      bucket: "zircle-uploads",
      region: "auto",
      endpoint: "https://acc.r2.cloudflarestorage.com",
      access_key_id: "x",
      secret_access_key: "y",
      public_url_base: "https://pub-123.r2.dev/"
    )

    assert {:ok, _} = channel_message(ctx, "https://pub-123.r2.dev/AbCdEfGhIjKlMnOpQrStUv.webp")
    # Earlier local uploads stay valid for messages written after a switch.
    assert {:ok, _} = channel_message(ctx, @own_local)

    for url <- [
          "https://pub-123.r2.dev.evil.example/AbCdEfGhIjKlMnOpQrStUv.png",
          "https://pub-123.r2.dev/nested/AbCdEfGhIjKlMnOpQrStUv.png",
          "https://other-bucket.r2.dev/AbCdEfGhIjKlMnOpQrStUv.png"
        ] do
      assert {:error, _} = channel_message(ctx, url), url
    end
  end

  test "own_file_url?/1 recognizes what store/1 returns" do
    path = Path.join(System.tmp_dir!(), "upload-#{System.unique_integer([:positive])}.png")
    File.write!(path, <<0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0>>)
    on_exit(fn -> File.rm(path) end)

    {:ok, %{file_url: url}} =
      Uploads.store(%Plug.Upload{path: path, content_type: "image/png", filename: "a.png"})

    on_exit(fn -> File.rm(Path.join([:code.priv_dir(:backend), "static", url])) end)
    assert Uploads.own_file_url?(url)
  end
end
