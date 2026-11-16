defmodule BackendWeb.PrivateFileController do
  @moduledoc """
  `GET /api/files/:token` — serves a private file (a DM attachment) to
  whoever holds a still-valid link from `BackendWeb.PrivateFileURL`. No
  sign-in: the link itself is the permission, since `<img>` tags and
  downloads can't carry our bearer token. Anything else — expired,
  tampered, made up, or a file that's gone — is a plain 404.

  Images display inline; everything else downloads under its original
  name, so nothing uploaded is ever rendered as a page on our origin.
  """
  use BackendWeb, :controller

  alias Backend.Uploads
  alias BackendWeb.PrivateFileURL

  def show(conn, %{"token" => token}) do
    with {:ok, ref, file_name} <- PrivateFileURL.verify(token),
         {:ok, source} <- Uploads.read_private(ref) do
      conn
      |> put_resp_header("content-type", content_type(ref))
      # Shorter than the link's own lifetime, and never in a shared cache.
      |> put_resp_header("cache-control", "private, max-age=3600")
      |> put_disposition(Uploads.content_disposition(ref, file_name))
      |> send_source(source)
    else
      _ -> send_resp(conn, :not_found, "")
    end
  end

  defp content_type(ref) do
    case Uploads.content_type_for_url(ref) do
      "text/plain" -> "text/plain; charset=utf-8"
      type -> type
    end
  end

  defp put_disposition(conn, nil), do: conn
  defp put_disposition(conn, value), do: put_resp_header(conn, "content-disposition", value)

  defp send_source(conn, {:file, path}), do: send_file(conn, 200, path)
  defp send_source(conn, {:binary, data}), do: send_resp(conn, 200, data)
end
