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

  Two kinds of file are accepted:

    * images (PNG, JPEG, GIF, WEBP), shown inline in chat and the only kind
      allowed as a profile picture or server icon (`validate_own_image/2`);
    * documents and archives (PDF, TXT, ZIP, 7Z, RAR, DOCX, XLSX, PPTX),
      which readers download (see `content_disposition/2`).

  Browsers report non-image types inconsistently (Windows Chrome sends
  `application/x-zip-compressed` for a .zip, and often nothing for a .rar),
  so for those the file name's extension picks the type. Either way the
  file's own first bytes must match it (see `validate_signature/2`), and
  the stored type is always this module's canonical one, never the
  client's. Nothing a browser would run or render as a page (.exe, .html,
  .svg, macro-enabled Office files) is on the list.
  """

  require Logger

  import Ecto.Query, only: [from: 2]

  alias Backend.Repo
  alias Backend.Uploads.{Metadata, S3}

  # Stored extension => canonical content type.
  @image_types %{
    "png" => "image/png",
    "jpg" => "image/jpeg",
    "gif" => "image/gif",
    "webp" => "image/webp"
  }

  @file_types %{
    "pdf" => "application/pdf",
    "txt" => "text/plain",
    "zip" => "application/zip",
    "7z" => "application/x-7z-compressed",
    "rar" => "application/vnd.rar",
    "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }

  @types_by_extension Map.merge(@image_types, @file_types)
  @extensions_by_image_type Map.new(@image_types, fn {ext, type} -> {type, ext} end)
  # Names a user may give a file whose stored extension differs.
  @extension_aliases %{"jpeg" => "jpg"}

  @max_image_bytes 8 * 1024 * 1024
  @max_file_bytes 25 * 1024 * 1024

  @doc "Upload size limits in bytes, by kind."
  def max_bytes(:image), do: @max_image_bytes
  def max_bytes(:file), do: @max_file_bytes

  @doc """
  Validates and persists an uploaded `%Plug.Upload{}`.

  Returns `{:ok, %{file_url:, content_type:, file_name:, file_size:}}` or
  `{:error, :unsupported_type | :invalid_file_signature | :too_large | :invalid_file | :storage_full}`.
  `file_url` is a relative `/uploads/...` path for the local adapter, or an
  absolute `https://...` URL for the S3 adapter — either way it's ready to
  hand back to the client as-is (see `BackendWeb.UploadController`).
  `file_name` is the client's name for the file, cleaned up for display
  (see `clean_file_name/2`); it never touches the stored file's own name.
  """
  def store(%Plug.Upload{} = upload, opts \\ []) do
    visibility = if Keyword.get(opts, :private, false), do: :private, else: :public

    with {:ok, extension, content_type} <- resolve_type(upload),
         {:ok, _size} <- validate_size(upload.path, extension),
         :ok <- validate_signature(upload.path, content_type),
         {:ok, source, size} <- without_metadata(upload.path, content_type) do
      try do
        with :ok <- check_quota(size) do
          persist(source, upload.filename, extension, content_type, size, visibility)
        end
      after
        if source != upload.path, do: File.rm(source)
      end
    end
  end

  defp persist(source, client_name, extension, content_type, size, visibility) do
    filename = random_filename() <> "." <> extension
    file_name = clean_file_name(client_name, extension)
    disposition = content_disposition(filename, file_name)

    result =
      case {visibility, adapter()} do
        {:public, :s3} -> store_s3(source, filename, content_type, disposition)
        {:public, :local} -> store_local(source, filename)
        {:private, :s3} -> store_private_s3(source, filename, content_type)
        {:private, :local} -> store_private_local(source, filename)
      end

    with {:ok, file_url} <- result do
      record_stored(file_url, size)

      {:ok,
       %{file_url: file_url, content_type: content_type, file_name: file_name, file_size: size}}
    end
  end

  @doc """
  The storage limit in bytes (`config :backend, :uploads_quota_bytes`).
  Kept under the object store's free tier (Cloudflare R2: 10 GB) so the
  bill stays at zero: past it, new uploads are refused with
  `:storage_full` instead of being stored.
  """
  def quota_bytes, do: Application.get_env(:backend, :uploads_quota_bytes, 9 * 1024 * 1024 * 1024)

  @doc "Bytes stored so far, by every file ever saved (deletions aren't subtracted)."
  def stored_bytes do
    Repo.one(from u in "stored_uploads", select: type(coalesce(sum(u.size), 0), :integer))
  end

  # Two uploads checked at the same moment can both pass and overshoot by
  # at most one file each (25 MB) — far inside the gap between the limit
  # and the free tier.
  defp check_quota(size) do
    if stored_bytes() + size > quota_bytes(), do: {:error, :storage_full}, else: :ok
  end

  defp record_stored(file_url, size) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    # Schemaless insert: the uuid primary key isn't generated for us.
    row = %{id: Ecto.UUID.bingenerate(), file_url: file_url, size: size, inserted_at: now}
    Repo.insert_all("stored_uploads", [row])
  end

  # Images are stored without their EXIF/XMP/text metadata (location,
  # device, capture time — see Backend.Uploads.Metadata), written to a
  # temporary file next to the upload; other files are stored as they came.
  # An image whose structure doesn't parse is refused rather than stored
  # with its metadata.
  defp without_metadata(path, "image/" <> _ = content_type) do
    with {:ok, data} <- File.read(path),
         {:ok, cleaned} <- Metadata.strip(data, content_type) do
      cleaned_path = path <> ".clean"
      File.write!(cleaned_path, cleaned)
      {:ok, cleaned_path, byte_size(cleaned)}
    else
      _ -> {:error, :invalid_file}
    end
  end

  defp without_metadata(path, _content_type) do
    case File.stat(path) do
      {:ok, %{size: size}} -> {:ok, path, size}
      {:error, _} -> {:error, :invalid_file}
    end
  end

  # store/1's filenames: 16 random bytes, URL-safe base64 (22 characters),
  # plus one of @types_by_extension's extensions.
  @stored_name "[A-Za-z0-9_-]{22}\\.(?:" <>
                 Enum.join(Map.keys(@types_by_extension), "|") <> ")"
  @local_url Regex.compile!("\\A/uploads/" <> @stored_name <> "\\z")
  @bare_name Regex.compile!("\\A" <> @stored_name <> "\\z")

  @doc """
  True if `url` is a file `store/1` could have returned — a local
  `/uploads/<name>` path, or the configured S3 bucket's public URL for one
  of its names. Messages may only carry attachments like these (see
  `Backend.Chat.Message`/`Backend.DirectMessages.DmMessage`): an arbitrary
  URL would let a sender make every reader's browser fetch from a server of
  their choosing — a tracking pixel.

  Local paths stay accepted when S3 is configured, so files uploaded before
  switching storage keep working.
  """
  def own_file_url?(url) when is_binary(url) do
    Regex.match?(@local_url, url) or own_s3_url?(url)
  end

  def own_file_url?(_url), do: false

  defp own_s3_url?(url) do
    with :s3 <- adapter(),
         prefix when is_binary(prefix) <- S3.public_url_prefix(),
         true <- String.starts_with?(url, prefix) do
      Regex.match?(@bare_name, String.replace_prefix(url, prefix, ""))
    else
      _ -> false
    end
  end

  @private_ref Regex.compile!("\\Aprivate:" <> @stored_name <> "\\z")

  @doc """
  True for a reference `store(upload, private: true)` returns —
  `"private:<name>"`. It's not a URL: private files (DM attachments) are
  only ever handed out as expiring links (see `BackendWeb.PrivateFileURL`),
  and the reference itself never leaves the server except to the uploader.
  """
  def private_ref?(ref) when is_binary(ref), do: Regex.match?(@private_ref, ref)
  def private_ref?(_ref), do: false

  @doc """
  The contents of a private file: `{:ok, {:file, path}}` on local disk,
  `{:ok, {:binary, data}}` from S3, or `{:error, :not_found}`.
  """
  def read_private("private:" <> name = ref) do
    if private_ref?(ref), do: read_private(adapter(), name), else: {:error, :not_found}
  end

  def read_private(_ref), do: {:error, :not_found}

  defp read_private(:local, name) do
    path = Path.join(private_dir(), name)
    if File.regular?(path), do: {:ok, {:file, path}}, else: {:error, :not_found}
  end

  defp read_private(:s3, name) do
    case S3.download("private/" <> name) do
      {:ok, data} -> {:ok, {:binary, data}}
      {:error, _} -> {:error, :not_found}
    end
  end

  @doc "True if `url` is one of our stored files (see `own_file_url?/1`) and an image."
  def image_url?(url), do: own_file_url?(url) and Map.has_key?(@image_types, extension_of(url))

  @doc """
  The canonical content type of a stored file, read off its URL's
  extension, or `nil` if that isn't an extension `store/1` writes.
  """
  def content_type_for_url(url) when is_binary(url),
    do: Map.get(@types_by_extension, extension_of(url))

  def content_type_for_url(_url), do: nil

  defp extension_of(url), do: url |> Path.extname() |> String.trim_leading(".")

  @doc """
  Changeset validation: `field`, when set, must be an image `store/1`
  produced (see `image_url?/1`) — a stored PDF or zip is a valid message
  attachment, but never a profile picture or server icon.
  """
  def validate_own_image(%Ecto.Changeset{} = changeset, field) do
    Ecto.Changeset.validate_change(changeset, field, fn ^field, url ->
      if image_url?(url), do: [], else: [{field, "must be an uploaded image"}]
    end)
  end

  @doc """
  Changeset validation for a message's attachment fields (`file_url`,
  `file_type`, `file_name`, `file_size` — see `Backend.Chat.Message` and
  `Backend.DirectMessages.DmMessage`):

    * `file_url` must be a file `store/2` produced, not any URL a client
      sends: a public upload (see `own_file_url?/1`) for `:public`
      (channel messages), a private reference (see `private_ref?/1`) for
      `:private` (DMs — never shown to anyone but their two participants,
      and only through expiring links);
    * `file_type` must be the type that file was stored as — otherwise a
      .zip could be labelled an image (or a .png a document) and every
      reader's client would render it as the wrong thing. Filled in from
      the URL when the client leaves it out;
    * `file_name` is display text only, at most 255 characters;
    * `file_size` is a positive byte count.
  """
  def validate_attachment(%Ecto.Changeset{} = changeset, visibility)
      when visibility in [:public, :private] do
    import Ecto.Changeset

    allowed? = if visibility == :public, do: &own_file_url?/1, else: &private_ref?/1

    changeset
    |> validate_change(:file_url, fn :file_url, url ->
      if allowed?.(url), do: [], else: [file_url: "is not an uploaded file"]
    end)
    |> validate_change(:file_type, fn :file_type, type ->
      if allowed_content_type?(type),
        do: [],
        else: [file_type: "is not a supported attachment type"]
    end)
    |> validate_type_matches_file()
    |> validate_length(:file_name, max: 255)
    |> validate_number(:file_size, greater_than: 0)
  end

  defp validate_type_matches_file(changeset) do
    url = Ecto.Changeset.get_field(changeset, :file_url)
    stored_type = content_type_for_url(url)

    case Ecto.Changeset.get_field(changeset, :file_type) do
      _ when is_nil(stored_type) or not changeset.valid? ->
        changeset

      nil ->
        Ecto.Changeset.put_change(changeset, :file_type, stored_type)

      ^stored_type ->
        changeset

      _other ->
        Ecto.Changeset.add_error(changeset, :file_type, "does not match the uploaded file")
    end
  end

  @doc "True for the content types `store/1` produces (and so the only ones an attachment can have)."
  def allowed_content_type?(content_type),
    do: content_type in Map.values(@types_by_extension)

  @doc """
  The `Content-Disposition` a stored file is served with: `nil` (inline) for
  images, otherwise `attachment` — browsers then download the file instead
  of rendering it on our origin — with `file_name` as the suggested name
  when known. The quoted `filename` is an ASCII-only fallback; `filename*`
  (RFC 6266/5987) carries the real UTF-8 name.
  """
  def content_disposition(url_or_name, file_name) do
    cond do
      Map.has_key?(@image_types, extension_of(url_or_name)) ->
        nil

      is_binary(file_name) and file_name != "" ->
        ascii = String.replace(file_name, ~r/[^\x20-\x7E]|["\\]/u, "_")
        encoded = URI.encode(file_name, &URI.char_unreserved?/1)
        ~s(attachment; filename="#{ascii}"; filename*=UTF-8''#{encoded})

      true ->
        "attachment"
    end
  end

  @doc """
  The name a stored file should download under when a link asks for
  `requested` (see `BackendWeb.UploadDispositionPlug`): the requested name,
  cleaned up like an uploaded one (see `clean_file_name/2`), with the stored
  file's own extension added unless it already ends in it — so a link can
  rename a PDF, but never make it download as a `.exe`. `nil` when there's
  nothing usable to go on.
  """
  def download_name(url_or_name, requested) when is_binary(requested) do
    extension = extension_of(url_or_name)

    with true <- Map.has_key?(@types_by_extension, extension),
         cleaned when cleaned != "" <- clean_file_name(requested, "") do
      requested_extension =
        cleaned |> Path.extname() |> String.trim_leading(".") |> String.downcase()

      if Map.get(@extension_aliases, requested_extension, requested_extension) == extension,
        do: cleaned,
        else: cleaned <> "." <> extension
    else
      _ -> nil
    end
  end

  def download_name(_url_or_name, _requested), do: nil

  defp store_local(path, filename) do
    dest = Path.join(upload_dir(), filename)
    File.mkdir_p!(upload_dir())

    case File.cp(path, dest) do
      :ok -> {:ok, "/uploads/#{filename}"}
      {:error, _} -> {:error, :invalid_file}
    end
  end

  # Private files: outside priv/static (so Plug.Static never serves them)
  # locally, under private/ in the bucket on S3 — whose public URL for that
  # key is never computed, let alone handed out.
  defp store_private_local(path, filename) do
    File.mkdir_p!(private_dir())

    case File.cp(path, Path.join(private_dir(), filename)) do
      :ok -> {:ok, "private:" <> filename}
      {:error, _} -> {:error, :invalid_file}
    end
  end

  defp store_private_s3(path, filename, content_type) do
    case S3.upload(path, "private/" <> filename, content_type) do
      {:ok, _public_url} ->
        {:ok, "private:" <> filename}

      {:error, reason} ->
        Logger.error("Backend.Uploads: S3 private store failed: #{inspect(reason)}")
        {:error, :invalid_file}
    end
  end

  defp store_s3(path, filename, content_type, disposition) do
    extra_headers = if disposition, do: [{"content-disposition", disposition}], else: []

    case S3.upload(path, filename, content_type, extra_headers) do
      {:ok, url} ->
        {:ok, url}

      {:error, reason} ->
        Logger.error("Backend.Uploads: S3 store failed: #{inspect(reason)}")
        {:error, :invalid_file}
    end
  end

  # An image's declared type is trusted as a starting point (it's how
  # uploads have always worked, and pasted screenshots often have no useful
  # name); anything else is looked up by extension. The signature check
  # that follows is what actually vouches for the content.
  defp resolve_type(%Plug.Upload{content_type: declared, filename: name}) do
    case Map.fetch(@extensions_by_image_type, declared) do
      {:ok, extension} ->
        {:ok, extension, declared}

      :error ->
        extension =
          name
          |> to_string()
          |> Path.extname()
          |> String.trim_leading(".")
          |> String.downcase()

        extension = Map.get(@extension_aliases, extension, extension)

        case Map.fetch(@types_by_extension, extension) do
          {:ok, type} -> {:ok, extension, type}
          :error -> {:error, :unsupported_type}
        end
    end
  end

  # Strips any directory part (either separator — the name comes from the
  # client's OS), control characters and bidirectional-override characters
  # (a right-to-left override in the middle of a name makes the rest display
  # reversed, so "fatura<RLO>fdp.zip" reads as "faturapiz.pdf"), and caps the
  # length. Falls back to a generic name if nothing is left.
  @unsafe_name_chars ~r/[\x{0000}-\x{001F}\x{007F}-\x{009F}\x{200E}\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u

  defp clean_file_name(name, extension) do
    cleaned =
      if is_binary(name) and String.valid?(name) do
        name
        |> String.split(["/", "\\"])
        |> List.last()
        |> String.replace(@unsafe_name_chars, "")
        |> String.trim()
        |> String.slice(0, 255)
      else
        ""
      end

    cond do
      cleaned != "" -> cleaned
      extension == "" -> ""
      true -> "dosya." <> extension
    end
  end

  # Client-declared Content-Type headers (and file names) are trivially
  # spoofable — a malicious client could label an .html or .svg payload as
  # "image/png" or call it "fatura.pdf" to get it stored. Cross-checking the
  # file's actual magic bytes against the resolved type closes that off.
  @header_bytes_needed 12

  defp validate_signature(path, "text/plain") do
    case File.read(path) do
      {:ok, body} ->
        if String.valid?(body) and not String.contains?(body, <<0>>),
          do: :ok,
          else: {:error, :invalid_file_signature}

      {:error, _} ->
        {:error, :invalid_file}
    end
  end

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

  @zip_based [
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ]

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

  defp signature_matches?("application/pdf", <<"%PDF-", _::binary>>), do: true

  # DOCX/XLSX/PPTX are zip archives too. "PK\x03\x04" starts a local file
  # header; "PK\x05\x06" is the end record an empty archive starts with.
  defp signature_matches?(type, <<"PK", 3, 4, _::binary>>) when type in @zip_based, do: true
  defp signature_matches?("application/zip", <<"PK", 5, 6, _::binary>>), do: true

  defp signature_matches?(
         "application/x-7z-compressed",
         <<"7z", 0xBC, 0xAF, 0x27, 0x1C, _::binary>>
       ),
       do: true

  # RAR 4 ("Rar!\x1A\x07\x00") and RAR 5 ("Rar!\x1A\x07\x01\x00") share this prefix.
  defp signature_matches?("application/vnd.rar", <<"Rar!", 0x1A, 0x07, _::binary>>), do: true

  defp signature_matches?(_content_type, _header), do: false

  defp validate_size(path, extension) do
    max = if Map.has_key?(@image_types, extension), do: @max_image_bytes, else: @max_file_bytes

    case File.stat(path) do
      {:ok, %{size: size}} when size <= max -> {:ok, size}
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

  defp private_dir do
    Path.join(:code.priv_dir(:backend), "private_uploads")
  end

  defp adapter do
    :backend |> Application.get_env(:uploads, []) |> Keyword.get(:adapter, :local)
  end
end
