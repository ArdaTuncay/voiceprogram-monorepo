defmodule BackendWeb.UploadController do
  use BackendWeb, :controller

  alias Backend.Uploads

  # See BackendWeb.RateLimiterPlug — caps how many uploads (accepted or
  # rejected, size/type validation runs after this) one IP can push per
  # minute, so uploading can't be used to fill disk/S3 storage or hammer
  # write throughput.
  plug BackendWeb.RateLimiterPlug, [scale: :timer.minutes(1), limit: 10] when action in [:create]

  @doc """
  POST /api/upload — stores a multipart file upload (see `Backend.Uploads`),
  returns its public URL, canonical type, display name and size in bytes.

  With `private=true` (DM attachments) the file is stored privately and
  `file_url` is a `"private:…"` reference rather than a URL: it goes into
  the DM message, and readers get expiring links to it (see
  `BackendWeb.PrivateFileURL`).
  """
  def create(conn, %{"file" => %Plug.Upload{} = upload} = params) do
    case Uploads.store(upload, private: params["private"] in ["true", true]) do
      {:ok, stored} ->
        json(conn, %{
          file_url: stored.file_url,
          file_type: stored.content_type,
          file_name: stored.file_name,
          file_size: stored.file_size
        })

      {:error, :unsupported_type} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error:
            gettext("Unsupported file type. Allowed: %{types}",
              types: "PNG, JPEG, GIF, WEBP, PDF, TXT, ZIP, 7Z, RAR, DOCX, XLSX, PPTX"
            )
        })

      {:error, :invalid_file_signature} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: gettext("The file's content doesn't match its extension")})

      {:error, :too_large} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error:
            gettext(
              "File is too large (images up to %{image_mb} MB, other files up to %{file_mb} MB)",
              image_mb: mb(:image),
              file_mb: mb(:file)
            )
        })

      {:error, :invalid_file} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: gettext("The file couldn't be uploaded")})
    end
  end

  def create(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: gettext("No file to upload")})
  end

  defp mb(kind), do: div(Uploads.max_bytes(kind), 1024 * 1024)
end
