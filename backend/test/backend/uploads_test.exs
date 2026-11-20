defmodule Backend.UploadsTest do
  @moduledoc """
  Non-image attachments (PDF, archives, Office documents, plain text).

  Browsers report these types inconsistently (Windows Chrome sends
  `application/x-zip-compressed` for a .zip and often nothing at all for a
  .rar), so for them the file's extension picks the type and the file's
  own first bytes have to agree with it. Anything not on the list — and in
  particular anything a browser would run or render as a page (.exe, .html,
  .svg) — is refused.
  """
  use Backend.DataCase, async: true

  alias Backend.Uploads

  @png_header <<0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0>>
  @zip_header <<0x50, 0x4B, 0x03, 0x04, 20, 0, 0, 0, 8, 0, 0, 0>>

  defp upload(filename, content_type, body) do
    path = Path.join(System.tmp_dir!(), "upl-#{System.unique_integer([:positive])}")
    File.write!(path, body)
    on_exit(fn -> File.rm(path) end)
    %Plug.Upload{path: path, filename: filename, content_type: content_type}
  end

  defp store!(filename, content_type, body) do
    assert {:ok, result} = Uploads.store(upload(filename, content_type, body))

    on_exit(fn ->
      File.rm(Path.join([:code.priv_dir(:backend), "static", result.file_url]))
    end)

    result
  end

  describe "store/1 accepts" do
    test "a PDF, keeping its name and size" do
      body = "%PDF-1.7\n" <> String.duplicate("x", 100)
      result = store!("Rapor 2026.pdf", "application/pdf", body)

      assert result.file_url =~ ~r"\A/uploads/[A-Za-z0-9_-]{22}\.pdf\z"
      assert result.content_type == "application/pdf"
      assert result.file_name == "Rapor 2026.pdf"
      assert result.file_size == byte_size(body)
      assert Uploads.own_file_url?(result.file_url)
    end

    test "a zip, whatever the browser called it" do
      for declared <- ["application/zip", "application/x-zip-compressed", ""] do
        result = store!("arsiv.zip", declared, @zip_header)
        assert result.content_type == "application/zip"
        assert String.ends_with?(result.file_url, ".zip")
      end
    end

    test "7z and rar archives" do
      assert store!("a.7z", "", <<"7z", 0xBC, 0xAF, 0x27, 0x1C, 0, 4>>).content_type ==
               "application/x-7z-compressed"

      assert store!("a.RAR", "application/octet-stream", <<"Rar!", 0x1A, 0x07, 0x01, 0>>).content_type ==
               "application/vnd.rar"
    end

    test "Office documents" do
      assert store!("cv.docx", "", @zip_header).content_type ==
               "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

      assert store!("t.xlsx", "", @zip_header).content_type ==
               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

      assert store!("s.pptx", "", @zip_header).content_type ==
               "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    end

    test "UTF-8 plain text" do
      assert store!("notlar.txt", "text/plain", "merhaba dünya\nçğış").content_type ==
               "text/plain"
    end

    test "a non-image just over the image limit" do
      body = "%PDF-1.4\n" <> :binary.copy("a", 9 * 1024 * 1024)
      assert store!("buyuk.pdf", "application/pdf", body).file_size == byte_size(body)
    end

    test "images exactly as before" do
      png = File.read!(Path.expand("../support/fixtures/images/location.png", __DIR__))
      result = store!("foto.png", "image/png", png)
      assert result.content_type == "image/png"
      assert String.ends_with?(result.file_url, ".png")
    end
  end

  describe "store/1 refuses" do
    for {name, type, body} <- [
          {"setup.exe", "application/x-msdownload", "MZ\x90\0\x03\0\0\0\x04\0\0\0"},
          {"sayfa.html", "text/html", "<html><script>alert(1)</script>"},
          {"logo.svg", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg'/>"},
          {"makro.docm", "", <<0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0>>},
          {"uzantisiz", "application/pdf", "%PDF-1.7\n"}
        ] do
      test "#{name} as an unsupported type" do
        assert {:error, :unsupported_type} =
                 Uploads.store(upload(unquote(name), unquote(type), unquote(body)))
      end
    end

    test "a file whose bytes don't match its extension" do
      assert {:error, :invalid_file_signature} =
               Uploads.store(upload("fatura.pdf", "application/pdf", "<html>phish</html>"))

      assert {:error, :invalid_file_signature} =
               Uploads.store(upload("arsiv.zip", "application/zip", "%PDF-1.7\n"))
    end

    test "text that isn't valid UTF-8 or contains NUL bytes" do
      assert {:error, :invalid_file_signature} =
               Uploads.store(upload("a.txt", "text/plain", <<0xFF, 0xFE, 0x41>>))

      assert {:error, :invalid_file_signature} =
               Uploads.store(upload("a.txt", "text/plain", "MZ\0\0binary"))
    end

    test "a non-image over 25 MB and an image over 8 MB" do
      big_pdf = "%PDF-1.4\n" <> :binary.copy("a", 25 * 1024 * 1024)
      assert {:error, :too_large} = Uploads.store(upload("dev.pdf", "application/pdf", big_pdf))

      big_png = @png_header <> :binary.copy(<<0>>, 8 * 1024 * 1024)
      assert {:error, :too_large} = Uploads.store(upload("dev.png", "image/png", big_png))
    end
  end

  describe "file names" do
    test "lose any directory part and control characters" do
      assert store!("../../etc/x\u0000y.pdf", "application/pdf", "%PDF-1.7\n").file_name ==
               "xy.pdf"

      assert store!("C:\\Users\\ali\\gizli.pdf", "application/pdf", "%PDF-1.7\n").file_name ==
               "gizli.pdf"
    end

    test "are capped at 255 characters" do
      long = String.duplicate("ş", 300) <> ".pdf"
      name = store!(long, "application/pdf", "%PDF-1.7\n").file_name
      assert String.length(name) == 255
    end
  end

  describe "own_file_url? and validate_own_image" do
    test "a stored PDF is ours, but never an image" do
      pdf = "/uploads/AbCdEfGhIjKlMnOpQrStUv.pdf"
      assert Uploads.own_file_url?(pdf)
      assert Uploads.image_url?("/uploads/AbCdEfGhIjKlMnOpQrStUv.webp")
      refute Uploads.image_url?(pdf)
    end

    test "content_type_for_url/1 maps a stored name back to its type" do
      assert Uploads.content_type_for_url("/uploads/AbCdEfGhIjKlMnOpQrStUv.jpg") == "image/jpeg"

      assert Uploads.content_type_for_url("/uploads/AbCdEfGhIjKlMnOpQrStUv.7z") ==
               "application/x-7z-compressed"

      assert Uploads.content_type_for_url("/uploads/x.exe") == nil
    end
  end

  describe "content_disposition/1" do
    test "images are shown inline, everything else downloads under its own name" do
      assert Uploads.content_disposition("/uploads/AbCdEfGhIjKlMnOpQrStUv.png", "a.png") == nil

      assert Uploads.content_disposition("/uploads/AbCdEfGhIjKlMnOpQrStUv.pdf", "Özet \"v2\".pdf") ==
               ~s(attachment; filename="_zet _v2_.pdf"; filename*=UTF-8''%C3%96zet%20%22v2%22.pdf)

      assert Uploads.content_disposition("/uploads/AbCdEfGhIjKlMnOpQrStUv.zip", nil) ==
               "attachment"
    end
  end
end
