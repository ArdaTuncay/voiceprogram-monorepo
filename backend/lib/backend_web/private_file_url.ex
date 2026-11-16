defmodule BackendWeb.PrivateFileURL do
  @moduledoc """
  Expiring links to private files (DM attachments — see
  `Backend.Uploads.private_ref?/1`): `/api/files/<token>`, served by
  `BackendWeb.PrivateFileController` to anyone holding the link until it
  expires — an `<img>` or a download can't send our bearer token.

  The token is encrypted, not just signed (`Phoenix.Token.encrypt/4`), so a
  leaked link doesn't reveal which stored file it points to: whoever ends
  up with it can't attach that file to a message of their own to mint a
  fresh link once it has expired. It carries the file's reference, its
  original name (for the download) and an expiry.

  DM messages get links valid for #{div(24 * 3600, 3600)} hours, re-issued
  every time the conversation is loaded; a DM report email gets one valid
  for 7 days, long enough for someone to look at it.
  """

  alias Backend.Uploads

  @salt "private file v1"
  @message_ttl 24 * 3600
  # Upper bound for any link we issue; each link's own expiry is checked too.
  @max_age 8 * 24 * 3600

  @doc "A link path valid for `ttl` seconds."
  @spec path(String.t(), String.t() | nil, integer()) :: String.t()
  def path(ref, file_name, ttl) do
    expires_at = System.system_time(:second) + ttl

    "/api/files/" <>
      Phoenix.Token.encrypt(BackendWeb.Endpoint, @salt, {ref, file_name, expires_at})
  end

  @doc "An absolute link (for emails), valid for `ttl` seconds."
  @spec url(String.t(), String.t() | nil, integer()) :: String.t()
  def url(ref, file_name, ttl), do: BackendWeb.Endpoint.url() <> path(ref, file_name, ttl)

  @doc "The reference and original name a still-valid token stands for, or `:error`."
  @spec verify(String.t()) :: {:ok, String.t(), String.t() | nil} | :error
  def verify(token) do
    with {:ok, {ref, file_name, expires_at}} <-
           Phoenix.Token.decrypt(BackendWeb.Endpoint, @salt, token, max_age: @max_age),
         true <- is_binary(ref) and is_integer(expires_at),
         true <- expires_at >= System.system_time(:second) do
      {:ok, ref, file_name}
    else
      _ -> :error
    end
  end

  @doc """
  What a message's `file_url` should be on the wire: a fresh link for a
  private file, the stored URL for anything else (public uploads, `nil`).
  """
  @spec for_message(%{file_url: String.t() | nil, file_name: String.t() | nil}) ::
          String.t() | nil
  def for_message(%{file_url: ref, file_name: file_name}) do
    if Uploads.private_ref?(ref), do: path(ref, file_name, @message_ttl), else: ref
  end
end
