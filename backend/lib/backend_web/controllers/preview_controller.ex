defmodule BackendWeb.PreviewController do
  use BackendWeb, :controller

  alias Backend.LinkPreview

  # This is the one authenticated endpoint that makes the server itself
  # issue an outbound HTTP request to a caller-supplied URL — SSRF
  # protection already lives in Backend.LinkPreview, but with no rate limit
  # a single user could still spam it to burn the server's own outbound
  # bandwidth/connection pool, or use it as a proxy against third-party
  # sites. See BackendWeb.RateLimiterPlug.
  plug BackendWeb.RateLimiterPlug, [scale: :timer.minutes(1), limit: 15] when action in [:show]

  @doc "GET /api/utils/preview?url=... — fetches OpenGraph metadata for a chat link-preview card."
  def show(conn, %{"url" => url}) do
    case LinkPreview.fetch(url) do
      {:ok, preview} ->
        json(conn, preview)

      {:error, :invalid_url} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Invalid URL"})

      {:error, :fetch_failed} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Could not fetch preview"})
    end
  end

  def show(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "url gerekli"})
  end
end
