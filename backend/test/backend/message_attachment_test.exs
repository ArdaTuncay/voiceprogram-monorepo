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

  defp channel_message(ctx, file_url, file_type \\ "image/png", extra \\ %{}) do
    Chat.create_message(
      Map.merge(
        %{
          content: "ek",
          file_url: file_url,
          file_type: file_type,
          user_id: ctx.owner.id,
          channel_id: ctx.channel.id
        },
        extra
      )
    )
  end

  defp dm_message(ctx, file_url, file_type \\ "image/png", extra \\ %{}) do
    DirectMessages.create_message(
      Map.merge(
        %{
          content: "ek",
          file_url: file_url,
          file_type: file_type,
          user_id: ctx.owner.id,
          dm_room_id: ctx.room.id
        },
        extra
      )
    )
  end

  # Channel messages carry public uploads; DM messages only private
  # references, handed out as expiring links (see BackendWeb.PrivateFileURL).
  defp own(:channel_message, ext), do: "/uploads/AbCdEfGhIjKlMnOpQrStUv.#{ext}"
  defp own(:dm_message, ext), do: "private:AbCdEfGhIjKlMnOpQrStUv.#{ext}"

  describe "public vs private" do
    test "a DM rejects a public upload and a channel a private one", ctx do
      assert {:error, changeset} = dm_message(ctx, own(:channel_message, "png"))
      assert %{file_url: [_ | _]} = errors_on(changeset)

      assert {:error, changeset} = channel_message(ctx, own(:dm_message, "png"))
      assert %{file_url: [_ | _]} = errors_on(changeset)
    end

    for ref <- [
          "private:../../etc/passwd",
          "private:kisa.png",
          "private:AbCdEfGhIjKlMnOpQrStUv.svg"
        ] do
      test "a DM rejects #{ref}", ctx do
        assert {:error, changeset} = dm_message(ctx, unquote(ref))
        assert %{file_url: [_ | _]} = errors_on(changeset)
      end
    end
  end

  for kind <- [:channel_message, :dm_message] do
    describe "#{kind}" do
      test "accepts a file this server stored", ctx do
        assert {:ok, message} = unquote(kind)(ctx, own(unquote(kind), "png"))
        assert message.file_url == own(unquote(kind), "png")
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
        assert {:error, changeset} = unquote(kind)(ctx, own(unquote(kind), "png"), "text/html")
        assert %{file_type: [_ | _]} = errors_on(changeset)
      end

      test "accepts a stored PDF with its original name and size", ctx do
        assert {:ok, message} =
                 unquote(kind)(ctx, own(unquote(kind), "pdf"), "application/pdf", %{
                   file_name: "Sözleşme.pdf",
                   file_size: 12_345
                 })

        assert {message.file_name, message.file_size} == {"Sözleşme.pdf", 12_345}
      end

      # Otherwise a .zip could be labelled as an image (or a .png as a
      # document) and every reader's client would render it as the wrong thing.
      test "rejects a type that doesn't match the stored file", ctx do
        assert {:error, changeset} = unquote(kind)(ctx, own(unquote(kind), "pdf"), "image/png")
        assert %{file_type: [_ | _]} = errors_on(changeset)

        assert {:error, changeset} =
                 unquote(kind)(ctx, own(unquote(kind), "png"), "application/pdf")

        assert %{file_type: [_ | _]} = errors_on(changeset)
      end

      test "rejects an over-long name or a nonsensical size", ctx do
        long = %{file_name: String.duplicate("a", 256), file_size: 1}

        assert {:error, changeset} =
                 unquote(kind)(ctx, own(unquote(kind), "pdf"), "application/pdf", long)

        assert %{file_name: [_ | _]} = errors_on(changeset)

        negative = %{file_name: "a.pdf", file_size: -1}

        assert {:error, changeset} =
                 unquote(kind)(ctx, own(unquote(kind), "pdf"), "application/pdf", negative)

        assert %{file_size: [_ | _]} = errors_on(changeset)
      end
    end
  end

  test "deleting a message also wipes the attachment's name and size", ctx do
    {:ok, message} =
      channel_message(ctx, own(:channel_message, "pdf"), "application/pdf", %{
        file_name: "a.pdf",
        file_size: 9
      })

    {:ok, deleted} =
      Chat.delete_message(message.id, %{user_id: ctx.owner.id, channel_id: ctx.channel.id})

    assert {deleted.file_name, deleted.file_size} == {nil, nil}

    {:ok, dm} =
      dm_message(ctx, own(:dm_message, "pdf"), "application/pdf", %{
        file_name: "a.pdf",
        file_size: 9
      })

    {:ok, deleted_dm} =
      DirectMessages.delete_message(dm.id, %{user_id: ctx.owner.id, dm_room_id: ctx.room.id})

    assert {deleted_dm.file_name, deleted_dm.file_size} == {nil, nil}
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

    assert {:ok, _} =
             channel_message(
               ctx,
               "https://pub-123.r2.dev/AbCdEfGhIjKlMnOpQrStUv.webp",
               "image/webp"
             )

    assert {:ok, _} =
             channel_message(
               ctx,
               "https://pub-123.r2.dev/AbCdEfGhIjKlMnOpQrStUv.zip",
               "application/zip"
             )

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
    File.cp!(Path.expand("../support/fixtures/images/location.png", __DIR__), path)
    on_exit(fn -> File.rm(path) end)

    {:ok, %{file_url: url}} =
      Uploads.store(%Plug.Upload{path: path, content_type: "image/png", filename: "a.png"})

    on_exit(fn -> File.rm(Path.join([:code.priv_dir(:backend), "static", url])) end)
    assert Uploads.own_file_url?(url)
  end
end
