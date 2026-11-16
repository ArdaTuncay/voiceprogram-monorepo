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
  """
  def create(conn, %{"file" => %Plug.Upload{} = upload}) do
    case Uploads.store(upload) do
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
            "Desteklenmeyen dosya türü. İzin verilenler: PNG, JPEG, GIF, WEBP, " <>
              "PDF, TXT, ZIP, 7Z, RAR, DOCX, XLSX, PPTX"
        })

      {:error, :invalid_file_signature} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Dosya içeriği uzantısıyla uyuşmuyor"})

      {:error, :too_large} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error:
            "Dosya çok büyük (resimler en fazla #{mb(:image)} MB, " <>
              "diğer dosyalar en fazla #{mb(:file)} MB)"
        })

      {:error, :invalid_file} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Dosya yüklenemedi"})
    end
  end

  def create(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "Yüklenecek dosya bulunamadı"})
  end

  defp mb(kind), do: div(Uploads.max_bytes(kind), 1024 * 1024)
end
