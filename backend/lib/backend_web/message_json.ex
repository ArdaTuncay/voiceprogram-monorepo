defmodule BackendWeb.MessageJSON do
  @moduledoc """
  Pieces of the message JSON shared by every place a channel or DM message
  is sent to a client (ChatChannel, DmChannel, ChannelController,
  DmController).
  """

  alias Backend.Accounts
  alias Backend.Chat.Message
  alias Backend.DirectMessages.DmMessage

  @preview_length 200

  @doc """
  A short preview of the message this one replies to, or nil. Needs
  `reply_to: :user` preloaded (Backend.Chat and Backend.DirectMessages
  always do). A deleted original keeps only who wrote it.
  """
  def reply_preview(%{reply_to: %struct{} = original}) when struct in [Message, DmMessage] do
    %{
      id: original.id,
      user_id: original.user_id,
      username: Accounts.display_username(original.user),
      content: original.content && String.slice(original.content, 0, @preview_length),
      has_file: not is_nil(original.file_url),
      is_deleted: not is_nil(original.deleted_at)
    }
  end

  def reply_preview(_message), do: nil
end
