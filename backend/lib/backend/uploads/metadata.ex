defmodule Backend.Uploads.Metadata do
  @moduledoc """
  Removes the metadata phones and cameras embed in photos — GPS position,
  device make/model, capture time, XMP, comments — before an upload is
  stored and shown to everyone who can see the message, profile picture or
  server icon. See `Backend.Uploads.store/1`.

  It works on the file's container structure only (JPEG segments, PNG
  chunks, RIFF chunks): the compressed image data is copied as-is, so
  there's no re-encoding, no quality loss and no image library to depend
  on. Anything that doesn't parse cleanly is an `:error` — the upload is
  refused rather than stored with its metadata.

    * JPEG: drops APP1 (EXIF, XMP), APP3–APP13, APP15 and comments, and
      anything after the end-of-image marker (some phones append extra
      images carrying their own EXIF there). Keeps APP0 (JFIF), APP2 ICC
      colour profiles and APP14 (Adobe colour transform). A photo's EXIF
      orientation is put back as a minimal EXIF block holding only that
      tag, so portrait shots don't display sideways.
    * PNG: drops `eXIf`, `tEXt`, `zTXt`, `iTXt` and `tIME`, and anything
      after `IEND`.
    * WebP: drops the `EXIF` and `XMP ` chunks and clears their `VP8X` flags.
    * GIF: unchanged — the format has no EXIF, and phones don't write GIFs.
  """

  import Bitwise

  @doc "Returns the image without its metadata, or `:error` if it doesn't parse."
  @spec strip(binary(), String.t()) :: {:ok, binary()} | :error
  def strip(data, "image/jpeg"), do: strip_jpeg(data)
  def strip(data, "image/png"), do: strip_png(data)
  def strip(data, "image/webp"), do: strip_webp(data)
  def strip(data, "image/gif"), do: {:ok, data}

  # ── JPEG ──────────────────────────────────────────────────────────────

  @soi <<0xFF, 0xD8>>
  @eoi <<0xFF, 0xD9>>

  defp strip_jpeg(<<0xFF, 0xD8, rest::binary>>) do
    with {:ok, kept, scan, orientation} <- jpeg_segments(rest, [], nil),
         {:ok, scan} <- through_eoi(scan) do
      {:ok, IO.iodata_to_binary([@soi, with_orientation(kept, orientation), scan])}
    end
  end

  defp strip_jpeg(_data), do: :error

  # Walks the header segments up to the start of scan (SOS); returns the
  # kept segments (in order), the SOS segment plus everything after it, and
  # the EXIF orientation if there was one.
  defp jpeg_segments(<<0xFF, 0xFF, rest::binary>>, kept, orientation),
    # Fill bytes before a marker are allowed.
    do: jpeg_segments(<<0xFF, rest::binary>>, kept, orientation)

  defp jpeg_segments(<<0xFF, 0xDA, _::binary>> = scan, kept, orientation),
    do: {:ok, Enum.reverse(kept), scan, orientation}

  defp jpeg_segments(<<0xFF, marker, len::16, rest::binary>>, kept, orientation)
       when len >= 2 and byte_size(rest) >= len - 2 do
    body = binary_part(rest, 0, len - 2)
    next = binary_part(rest, len - 2, byte_size(rest) - (len - 2))
    segment = <<0xFF, marker, len::16, body::binary>>

    case marker do
      0xE1 -> jpeg_segments(next, kept, orientation || exif_orientation(body))
      m when m in [0xE0, 0xEE] -> jpeg_segments(next, [segment | kept], orientation)
      0xE2 -> jpeg_segments(next, keep_icc(segment, body, kept), orientation)
      m when m in 0xE3..0xEF or m == 0xFE -> jpeg_segments(next, kept, orientation)
      _other -> jpeg_segments(next, [segment | kept], orientation)
    end
  end

  defp jpeg_segments(_data, _kept, _orientation), do: :error

  defp keep_icc(segment, <<"ICC_PROFILE", 0, _::binary>>, kept), do: [segment | kept]
  defp keep_icc(_segment, _body, kept), do: kept

  # Entropy-coded data can't contain 0xFF 0xD9 (0xFF is byte-stuffed), so
  # the first one after the scan starts is the real end of image; whatever
  # follows is dropped.
  defp through_eoi(scan) do
    case :binary.match(scan, @eoi) do
      {pos, 2} -> {:ok, binary_part(scan, 0, pos + 2)}
      :nomatch -> :error
    end
  end

  # The minimal EXIF block goes right after a leading JFIF/APP0 segment, if
  # there is one — EXIF readers expect it near the start.
  defp with_orientation(kept, orientation) when orientation in [nil, 1], do: kept

  defp with_orientation([<<0xFF, 0xE0, _::binary>> = app0 | rest], orientation),
    do: [app0, orientation_segment(orientation) | rest]

  defp with_orientation(kept, orientation), do: [orientation_segment(orientation) | kept]

  # "Exif\0\0", a big-endian TIFF header, and IFD0 with a single entry:
  # Orientation (0x0112), type SHORT (3), count 1.
  defp orientation_segment(orientation) do
    payload =
      <<"Exif", 0, 0, "MM", 42::16, 8::32, 1::16, 0x0112::16, 3::16, 1::32, orientation::16,
        0::16, 0::32>>

    <<0xFF, 0xE1, byte_size(payload) + 2::16, payload::binary>>
  end

  defp exif_orientation(<<"Exif", 0, 0, tiff::binary>>) do
    case tiff do
      <<"II", 42::little-16, ifd::little-32, _::binary>> -> ifd_orientation(tiff, ifd, :little)
      <<"MM", 42::big-16, ifd::big-32, _::binary>> -> ifd_orientation(tiff, ifd, :big)
      _ -> nil
    end
  end

  defp exif_orientation(_body), do: nil

  defp ifd_orientation(tiff, offset, endian) when byte_size(tiff) >= offset + 2 do
    count = read_uint(binary_part(tiff, offset, 2), endian)
    entries_size = min(count * 12, byte_size(tiff) - offset - 2)
    entries = binary_part(tiff, offset + 2, entries_size)

    for(<<entry::binary-size(12) <- entries>>, do: entry)
    |> Enum.find_value(fn <<tag::binary-size(2), _type::binary-size(2), _count::binary-size(4),
                            value::binary-size(2), _::binary>> ->
      if read_uint(tag, endian) == 0x0112, do: valid_orientation(read_uint(value, endian))
    end)
  end

  defp ifd_orientation(_tiff, _offset, _endian), do: nil

  defp valid_orientation(value) when value in 1..8, do: value
  defp valid_orientation(_value), do: nil

  defp read_uint(<<value::little-16>>, :little), do: value
  defp read_uint(<<value::big-16>>, :big), do: value

  @doc """
  The EXIF orientation (1–8) a JPEG declares, or `nil` — used by the tests
  to check that `strip/2` kept it.
  """
  @spec jpeg_orientation(binary()) :: 1..8 | nil
  def jpeg_orientation(<<0xFF, 0xD8, rest::binary>>) do
    case jpeg_segments(rest, [], nil) do
      {:ok, _kept, _scan, orientation} -> orientation
      :error -> nil
    end
  end

  # ── PNG ───────────────────────────────────────────────────────────────

  @png_signature <<0x89, "PNG", 0x0D, 0x0A, 0x1A, 0x0A>>
  @png_metadata ~w(eXIf tEXt zTXt iTXt tIME)

  defp strip_png(<<@png_signature, chunks::binary>>) do
    with {:ok, kept} <- png_chunks(chunks, []) do
      {:ok, IO.iodata_to_binary([@png_signature | kept])}
    end
  end

  defp strip_png(_data), do: :error

  defp png_chunks(<<len::32, "IEND", _::binary-size(len), _crc::32, _::binary>> = data, kept),
    do: {:ok, Enum.reverse([binary_part(data, 0, 12 + len) | kept])}

  defp png_chunks(
         <<len::32, type::binary-size(4), body::binary-size(len), crc::32, rest::binary>>,
         kept
       ) do
    if type in @png_metadata,
      do: png_chunks(rest, kept),
      else: png_chunks(rest, [<<len::32, type::binary, body::binary, crc::32>> | kept])
  end

  defp png_chunks(_data, _kept), do: :error

  # ── WebP ──────────────────────────────────────────────────────────────

  @vp8x_exif_xmp 0x08 ||| 0x04

  defp strip_webp(<<"RIFF", size::little-32, "WEBP", chunks::binary>>)
       when size == byte_size(chunks) + 4 do
    with {:ok, kept} <- webp_chunks(chunks, []) do
      body = IO.iodata_to_binary(kept)
      {:ok, <<"RIFF", byte_size(body) + 4::little-32, "WEBP", body::binary>>}
    end
  end

  defp strip_webp(_data), do: :error

  defp webp_chunks(<<>>, kept), do: {:ok, Enum.reverse(kept)}

  defp webp_chunks(<<fourcc::binary-size(4), len::little-32, rest::binary>>, kept) do
    padded = len + rem(len, 2)

    case rest do
      <<body::binary-size(^padded), next::binary>> ->
        webp_chunks(next, webp_chunk(fourcc, len, body, kept))

      _truncated ->
        :error
    end
  end

  defp webp_chunks(_data, _kept), do: :error

  defp webp_chunk(fourcc, _len, _body, kept) when fourcc in ["EXIF", "XMP "], do: kept

  defp webp_chunk("VP8X", len, <<flags, body::binary>>, kept),
    do: [<<"VP8X", len::little-32, flags &&& bnot(@vp8x_exif_xmp), body::binary>> | kept]

  defp webp_chunk(fourcc, len, body, kept),
    do: [<<fourcc::binary, len::little-32, body::binary>> | kept]
end
