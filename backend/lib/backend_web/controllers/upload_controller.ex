defmodule BackendWeb.UploadController do
  use BackendWeb, :controller

  alias Backend.Uploads

  @doc "POST /api/upload — stores a multipart file upload, returns its public URL."
  def create(conn, %{"file" => %Plug.Upload{} = upload}) do
    case Uploads.store(upload) do
      {:ok, %{filename: filename, content_type: content_type}} ->
        json(conn, %{file_url: "/uploads/#{filename}", file_type: content_type})

      {:error, :unsupported_type} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Desteklenmeyen dosya türü. İzin verilenler: PNG, JPEG, GIF, WEBP"})

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
