defmodule Backend.UploadsQuotaTest do
  @moduledoc """
  The total storage limit (`Backend.Uploads.quota_bytes/0`): every stored
  file's size is recorded, and once the total would pass the limit new
  uploads are refused instead of stored — so the object store's free tier
  is never exceeded. Not async: it changes the limit in the app env.
  """
  use Backend.DataCase, async: false

  alias Backend.Uploads

  setup do
    previous = Application.get_env(:backend, :uploads_quota_bytes)
    on_exit(fn -> Application.put_env(:backend, :uploads_quota_bytes, previous) end)
    :ok
  end

  defp pdf(bytes) do
    path = Path.join(System.tmp_dir!(), "quota-#{System.unique_integer([:positive])}")
    File.write!(path, "%PDF-1.7\n" <> String.duplicate("x", bytes - 9))
    on_exit(fn -> File.rm(path) end)
    %Plug.Upload{path: path, filename: "belge.pdf", content_type: "application/pdf"}
  end

  defp remove_stored(result) do
    on_exit(fn -> File.rm(Path.join([:code.priv_dir(:backend), "static", result.file_url])) end)
  end

  test "every stored file adds its size to the total" do
    before = Uploads.stored_bytes()

    assert {:ok, result} = Uploads.store(pdf(100))
    remove_stored(result)

    assert Uploads.stored_bytes() == before + 100
  end

  test "an upload that would pass the limit is refused and nothing is recorded" do
    Application.put_env(:backend, :uploads_quota_bytes, Uploads.stored_bytes() + 150)

    assert {:ok, result} = Uploads.store(pdf(100))
    remove_stored(result)
    total = Uploads.stored_bytes()

    assert {:error, :storage_full} = Uploads.store(pdf(100))
    assert Uploads.stored_bytes() == total
  end
end
