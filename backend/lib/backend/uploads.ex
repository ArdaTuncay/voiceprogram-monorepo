defmodule Backend.Uploads do
  @moduledoc """
  Stores uploaded chat attachments on local disk, under
  `priv/static/uploads`, served back out by `Plug.Static` (see
  `BackendWeb.static_paths/0` and `BackendWeb.Endpoint`).

  This is a local-disk stand-in for a cloud object store: no AWS
  credentials or S3-compatible server (e.g. MinIO/Docker) are available
  in this environment, so this is what's actually testable end-to-end
  here. `store/1` is the only entry point the rest of the app calls —
  swapping in a real `ex_aws_s3` upload later only means rewriting this
  one module.
  """

  @allowed_extensions %{
    "image/png" => ".png",
    "image/jpeg" => ".jpg",
    "image/gif" => ".gif",
    "image/webp" => ".webp"
  }

  @max_size_bytes 8 * 1024 * 1024

  @doc """
  Validates and persists an uploaded `%Plug.Upload{}`.

  Returns `{:ok, %{filename: filename, content_type: content_type}}` or
  `{:error, :unsupported_type | :too_large | :invalid_file}`.
  """
  def store(%Plug.Upload{} = upload) do
    with {:ok, extension} <- validate_type(upload.content_type),
         :ok <- validate_size(upload.path) do
      filename = random_filename() <> extension
      dest = Path.join(upload_dir(), filename)

      File.mkdir_p!(upload_dir())

      case File.cp(upload.path, dest) do
        :ok -> {:ok, %{filename: filename, content_type: upload.content_type}}
        {:error, _} -> {:error, :invalid_file}
      end
    end
  end

  defp validate_type(content_type) do
    case Map.fetch(@allowed_extensions, content_type) do
      {:ok, extension} -> {:ok, extension}
      :error -> {:error, :unsupported_type}
    end
  end

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
end
