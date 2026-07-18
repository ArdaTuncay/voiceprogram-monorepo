defmodule Backend.Uploads do
  @moduledoc """
  Stores uploaded chat attachments, either on local disk (dev default,
  under `priv/static/uploads`, served back out by `Plug.Static` — see
  `BackendWeb.static_paths/0`) or in an S3-compatible object store (AWS
  S3 / Cloudflare R2 / DigitalOcean Spaces — see `Backend.Uploads.S3`),
  selected via `config :backend, :uploads` (see config/runtime.exs).

  `store/1` is the only entry point the rest of the app calls — the
  adapter choice is entirely config-driven, so nothing else needs to
  change when switching from disk to cloud storage.
  """

  require Logger

  alias Backend.Uploads.S3

  @allowed_extensions %{
    "image/png" => ".png",
    "image/jpeg" => ".jpg",
    "image/gif" => ".gif",
    "image/webp" => ".webp"
  }

  @max_size_bytes 8 * 1024 * 1024

  @doc """
  Validates and persists an uploaded `%Plug.Upload{}`.

  Returns `{:ok, %{file_url: file_url, content_type: content_type}}` or
  `{:error, :unsupported_type | :invalid_file_signature | :too_large | :invalid_file}`.
  `file_url` is a relative `/uploads/...` path for the local adapter, or an
  absolute `https://...` URL for the S3 adapter — either way it's ready to
  hand back to the client as-is (see `BackendWeb.UploadController`).
  """
  def store(%Plug.Upload{} = upload) do
    with {:ok, extension} <- validate_type(upload.content_type),
         :ok <- validate_signature(upload.path, upload.content_type),
         :ok <- validate_size(upload.path) do
      filename = random_filename() <> extension

      case adapter() do
        :s3 -> store_s3(upload, filename)
        :local -> store_local(upload, filename)
      end
    end
  end

  defp store_local(upload, filename) do
    dest = Path.join(upload_dir(), filename)
    File.mkdir_p!(upload_dir())

    case File.cp(upload.path, dest) do
      :ok -> {:ok, %{file_url: "/uploads/#{filename}", content_type: upload.content_type}}
      {:error, _} -> {:error, :invalid_file}
    end
  end

  defp store_s3(upload, filename) do
    case S3.upload(upload.path, filename, upload.content_type) do
      {:ok, url} ->
        {:ok, %{file_url: url, content_type: upload.content_type}}

      {:error, reason} ->
        Logger.error("Backend.Uploads: S3 store failed: #{inspect(reason)}")
        {:error, :invalid_file}
    end
  end

  defp validate_type(content_type) do
    case Map.fetch(@allowed_extensions, content_type) do
      {:ok, extension} -> {:ok, extension}
      :error -> {:error, :unsupported_type}
    end
  end

  # Client-declared Content-Type headers are trivially spoofable — a
  # malicious client could label an .html or .svg payload as "image/png" to
  # get it stored (and later served back with a browser-guessed content
  # type). Cross-checking the file's actual magic bytes/signature against
  # what was declared closes that off.
  @header_bytes_needed 12

  defp validate_signature(path, content_type) do
    case read_header(path) do
      {:ok, header} ->
        if signature_matches?(content_type, header) do
          :ok
        else
          {:error, :invalid_file_signature}
        end

      {:error, _} ->
        {:error, :invalid_file}
    end
  end

  defp read_header(path) do
    case File.open(path, [:read, :binary]) do
      {:ok, file} ->
        header = IO.binread(file, @header_bytes_needed)
        File.close(file)

        case header do
          :eof -> {:error, :invalid_file}
          data when is_binary(data) -> {:ok, data}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp signature_matches?(
         "image/png",
         <<0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, _::binary>>
       ),
       do: true

  defp signature_matches?("image/jpeg", <<0xFF, 0xD8, 0xFF, _::binary>>), do: true

  # Covers both "GIF87a" and "GIF89a" — the two revisions of the format —
  # since they only diverge after this shared 4-byte "GIF8" prefix.
  defp signature_matches?("image/gif", <<0x47, 0x49, 0x46, 0x38, _::binary>>), do: true

  # WebP is a RIFF container: "RIFF" + 4-byte chunk size (skipped) + "WEBP".
  defp signature_matches?(
         "image/webp",
         <<0x52, 0x49, 0x46, 0x46, _size::binary-size(4), 0x57, 0x45, 0x42, 0x50, _::binary>>
       ),
       do: true

  defp signature_matches?(_content_type, _header), do: false

  defp validate_size(path) do
    case File.stat(path) do
      {:ok, %{size: size}} when size <= @max_size_bytes -> :ok
      {:ok, _too_big} -> {:error, :too_large}
      {:error, _} -> {:error, :invalid_file}
    end
  end

  defp random_filename do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end

  defp upload_dir do
    Path.join([:code.priv_dir(:backend), "static", "uploads"])
  end

  defp adapter do
    :backend |> Application.get_env(:uploads, []) |> Keyword.get(:adapter, :local)
  end
end
