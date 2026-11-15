defmodule Backend.Repo.Migrations.MakeUserEmailCaseInsensitive do
  @moduledoc """
  Makes email uniqueness case-insensitive: stored emails are normalized to
  trimmed lowercase, and the unique index moves from `email` to
  `lower(email)` (keeping the `users_email_index` name, so
  `unique_constraint(:email)` in `Backend.Accounts.User` still maps a
  violation to a normal changeset error).

  If two accounts already differ only by case/whitespace, the new index
  can't be built and there is no safe automatic fix — merging or renaming
  someone's login address is a decision for a person. In that case this
  migration stops *before* changing anything and lists them. Check
  beforehand with:

      SELECT lower(trim(email)) AS email, count(*), array_agg(id)
      FROM users GROUP BY 1 HAVING count(*) > 1;
  """
  use Ecto.Migration

  def up do
    %{rows: duplicates} =
      repo().query!("""
      SELECT lower(trim(email)), array_agg(id::text)
      FROM users
      GROUP BY lower(trim(email))
      HAVING count(*) > 1
      """)

    if duplicates != [] do
      raise """
      users tablosunda yalnızca büyük/küçük harf veya boşlukla ayrışan
      #{length(duplicates)} e-posta grubu var; büyük/küçük harf duyarsız
      benzersizlik indeksi oluşturulamaz. Hiçbir şey değiştirilmedi.
      Bu hesapları elle birleştirin veya e-postalarını değiştirin, sonra
      tekrar deploy edin:

      #{Enum.map_join(duplicates, "\n", fn [email, ids] -> "  #{email}: #{Enum.join(ids, ", ")}" end)}
      """
    end

    execute "UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email))"

    drop index(:users, [:email])
    create unique_index(:users, ["lower(email)"], name: :users_email_index)
  end

  def down do
    drop index(:users, ["lower(email)"], name: :users_email_index)
    create unique_index(:users, [:email])
  end
end
