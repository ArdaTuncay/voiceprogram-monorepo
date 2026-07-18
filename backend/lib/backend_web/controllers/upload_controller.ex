defmodule BackendWeb.UploadController do
  use BackendWeb, :controller

  alias Backend.Uploads

  # See BackendWeb.RateLimiterPlug — caps how many uploads (accepted or
  # rejected, size/type validation runs after this) one IP can push per
  # minute, so uploading can't be used to fill disk/S3 storage or hammer
  # write throughput.
  plug BackendWeb.RateLimiterPlug, [scale: :timer.minutes(1), limit: 10] when action in [:create]

  @doc "POST /api/upload — stores a multipart file upload, returns its public URL."
  def create(conn, %{"file" => %Plug.Upload{} = upload}) do
    case Uploads.store(upload) do
      {:ok, %{file_url: file_url, content_type: content_type}} ->
        json(conn, %{file_url: file_url, file_type: content_type})

      {:error, :unsupported_type} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Desteklenmeyen dosya türü. İzin verilenler: PNG, JPEG, GIF, WEBP"})

      {:error, :invalid_file_signature} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Dosya içeriği beyan edilen türle uyuşmuyor"})

      {:error, :too_large} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Dosya çok büyük (maksimum 8MB)"})

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
end
