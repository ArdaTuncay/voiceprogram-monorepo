defmodule Backend.Uploads.MetadataTest do
  @moduledoc """
  Uploaded photos lose the metadata cameras and phones embed — GPS position,
  device make/model, timestamps, XMP, comments — before they're stored and
  shown to everyone in a channel. The fixtures (test/support/fixtures/images)
  are real images written by Pillow with location data, device names and an
  XMP packet; the pixel data itself is never touched.
  """
  use ExUnit.Case, async: true

  alias Backend.Uploads
  alias Backend.Uploads.Metadata

  @fixtures Path.expand("../../support/fixtures/images", __DIR__)
  @secrets ["SecretPhoneMaker", "SecretModel", "GPSLatitude", "secret comment", "TRAILER"]

  defp fixture(name), do: File.read!(Path.join(@fixtures, name))

  defp refute_secrets(data) do
    for secret <- @secrets, do: refute(data =~ secret, "still contains #{secret}")
  end

  defp segments(<<0xFF, 0xD8, rest::binary>>), do: segments(rest, [])

  defp segments(<<0xFF, 0xDA, _::binary>>, acc), do: Enum.reverse([0xDA | acc])

  defp segments(<<0xFF, marker, len::16, rest::binary>>, acc) do
    segments(binary_part(rest, len - 2, byte_size(rest) - (len - 2)), [marker | acc])
  end

  describe "JPEG" do
    test "loses EXIF location/device data, XMP, comments and anything after the image" do
      {:ok, cleaned} = Metadata.strip(fixture("location.jpg"), "image/jpeg")

      refute_secrets(cleaned)
      assert binary_part(cleaned, byte_size(cleaned), -2) == <<0xFF, 0xD9>>
      # No comment (FE) segment, and at most one small APP1 left (see below).
      refute 0xFE in segments(cleaned)
      assert Enum.count(segments(cleaned), &(&1 == 0xE1)) == 1
      assert byte_size(cleaned) < byte_size(fixture("location.jpg"))
    end

    test "keeps only the orientation, so phone photos stay the right way up" do
      {:ok, cleaned} = Metadata.strip(fixture("location.jpg"), "image/jpeg")
      assert Metadata.jpeg_orientation(cleaned) == 6
    end

    test "adds nothing to a photo without metadata and keeps its image data" do
      plain = fixture("plain.jpg")
      {:ok, cleaned} = Metadata.strip(plain, "image/jpeg")

      refute 0xE1 in segments(cleaned)
      assert Metadata.jpeg_orientation(cleaned) == nil
      # JFIF header (APP0), tables and scan are what's left — byte for byte.
      assert cleaned == plain
    end

    test "rejects data that isn't a well-formed JPEG" do
      assert Metadata.strip(<<0xFF, 0xD8, 0xFF, 0xE1, 0, 200, "short">>, "image/jpeg") == :error
      assert Metadata.strip(<<0xFF, 0xD8, 0xFF>>, "image/jpeg") == :error
    end
  end

  describe "PNG" do
    test "loses eXIf and text chunks but keeps the image chunks" do
      {:ok, cleaned} = Metadata.strip(fixture("location.png"), "image/png")

      refute_secrets(cleaned)
      for chunk <- ["eXIf", "tEXt", "zTXt", "iTXt"], do: refute(cleaned =~ chunk)
      for chunk <- ["IHDR", "IDAT", "IEND"], do: assert(cleaned =~ chunk)
    end
  end

  describe "WebP" do
    test "loses EXIF and XMP chunks and clears their flags" do
      original = fixture("location.webp")
      {:ok, cleaned} = Metadata.strip(original, "image/webp")

      refute_secrets(cleaned)
      refute cleaned =~ "EXIF"
      refute cleaned =~ "XMP "

      <<"RIFF", size::little-32, "WEBP", "VP8X", _::little-32, flags, _::binary>> = cleaned
      assert size == byte_size(cleaned) - 8
      assert Bitwise.band(flags, 0x0C) == 0
    end
  end

  test "GIFs pass through unchanged" do
    gif =
      <<"GIF89a", 1::little-16, 1::little-16, 0, 0, 0, 0x2C, 0::64, 0x02, 0x02, 0x44, 0x01, 0,
        0x3B>>

    assert Metadata.strip(gif, "image/gif") == {:ok, gif}
  end

  describe "Uploads.store/1" do
    test "stores the cleaned photo and reports its cleaned size" do
      path = Path.join(System.tmp_dir!(), "exif-#{System.unique_integer([:positive])}.jpg")
      File.write!(path, fixture("location.jpg"))
      on_exit(fn -> File.rm(path) end)

      {:ok, stored} =
        Uploads.store(%Plug.Upload{
          path: path,
          filename: "IMG_0001.jpg",
          content_type: "image/jpeg"
        })

      stored_path = Path.join([:code.priv_dir(:backend), "static", stored.file_url])
      on_exit(fn -> File.rm(stored_path) end)

      saved = File.read!(stored_path)
      refute_secrets(saved)
      assert stored.file_size == byte_size(saved)
    end

    test "refuses an image whose structure can't be cleaned" do
      path = Path.join(System.tmp_dir!(), "exif-#{System.unique_integer([:positive])}.jpg")
      File.write!(path, <<0xFF, 0xD8, 0xFF, 0xE1, 0, 200, "short">>)
      on_exit(fn -> File.rm(path) end)

      assert {:error, :invalid_file} =
               Uploads.store(%Plug.Upload{
                 path: path,
                 filename: "a.jpg",
                 content_type: "image/jpeg"
               })
    end
  end
end
