import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent, DragEvent, UIEvent } from 'react';
import { AtSign, Paperclip, Send, AlertTriangle } from 'lucide-react';
import { resolveFileUrl } from '../config';
import { useDMStore } from '../stores/useDMStore';
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea';
import MessageItem from './MessageItem';
import SearchBar from './SearchBar';
import SearchResultsPanel from './SearchResultsPanel';

interface Props {
  currentUserId: string;
}

/** The DM equivalent of the server chat's message list + input, rendered
 * inside Chat.tsx's shared `<main className="chat-main">` — reuses the
 * same CSS classes for visual consistency without sharing any JS state. */
export default function DMChatView({ currentUserId }: Props) {
  const rooms = useDMStore((s) => s.rooms);
  const activeRoomId = useDMStore((s) => s.activeRoomId);
  const messages = useDMStore((s) => s.messages);
  const draft = useDMStore((s) => s.draft);
  const typingUsername = useDMStore((s) => s.typingUsername);
  const isUploading = useDMStore((s) => s.isUploading);
  const uploadError = useDMStore((s) => s.uploadError);
  const isDraggingFile = useDMStore((s) => s.isDraggingFile);
  const lightboxUrl = useDMStore((s) => s.lightboxUrl);
  const hasMoreMessages = useDMStore((s) => s.hasMoreMessages);
  const isLoadingOlderMessages = useDMStore((s) => s.isLoadingOlderMessages);
  const loadOlderMessages = useDMStore((s) => s.loadOlderMessages);
  const handleDraftChange = useDMStore((s) => s.handleDraftChange);
  const sendMessage = useDMStore((s) => s.sendMessage);
  const handleFileSelected = useDMStore((s) => s.handleFileSelected);
  const setDraggingFile = useDMStore((s) => s.setDraggingFile);
  const setLightboxUrl = useDMStore((s) => s.setLightboxUrl);
  const toggleReaction = useDMStore((s) => s.toggleReaction);
  const editMessage = useDMStore((s) => s.editMessage);
  const searchResults = useDMStore((s) => s.searchResults);
  const isSearching = useDMStore((s) => s.isSearching);
  const isSearchPanelOpen = useDMStore((s) => s.isSearchPanelOpen);
  const highlightedMessageId = useDMStore((s) => s.highlightedMessageId);
  const searchDmMessages = useDMStore((s) => s.searchDmMessages);
  const closeSearchPanel = useDMStore((s) => s.closeSearchPanel);
  const jumpToMessage = useDMStore((s) => s.jumpToMessage);
  const clearHighlight = useDMStore((s) => s.clearHighlight);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesWrapperRef = useRef<HTMLDivElement>(null);
  // Set right before a loadOlderMessages() call, to the scroll container's
  // scrollHeight at that moment; the layout effect below uses it to keep the
  // same message in view once the older page is prepended, instead of
  // scrolling to the bottom (the normal new-message behavior).
  const prevScrollHeightRef = useRef<number | null>(null);
  const textareaRef = useAutoGrowTextarea(draft);

  // Auto-scroll to bottom when messages change — except right after
  // prepending an older page (loadOlderMessages), where we instead restore
  // the scroll position so the message the user was looking at stays put.
  useLayoutEffect(() => {
    const container = messagesWrapperRef.current;
    if (container && prevScrollHeightRef.current !== null) {
      container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleMessagesScroll(e: UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop > 100) return;
    if (!hasMoreMessages || isLoadingOlderMessages) return;
    prevScrollHeightRef.current = e.currentTarget.scrollHeight;
    void loadOlderMessages();
  }

  // Scrolls a search result's target message into view once jumpToMessage
  // has confirmed it's loaded, then clears the highlight after a brief
  // flash so it doesn't linger indefinitely.
  useEffect(() => {
    if (!highlightedMessageId) return;
    document.getElementById(`message-${highlightedMessageId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    const timer = window.setTimeout(() => clearHighlight(), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId, clearHighlight]);

  const otherName = rooms.find((r) => r.id === activeRoomId)?.username ?? 'Bilinmeyen';

  function handleAttachClick() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFileSelected(file);
  }

  function handleDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    if (!isDraggingFile) setDraggingFile(true);
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDraggingFile(false);
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileSelected(file);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleDraftInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    handleDraftChange(e.target.value);
  }

  return (
    <>
    <main
      className="chat-main"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="chat-header">
        <span className="chat-header-hash"><AtSign size={20} /></span>
        <span className="chat-header-name">{otherName}</span>
        {activeRoomId && (
          <SearchBar isSearching={isSearching} onSearch={(filters) => void searchDmMessages(activeRoomId, filters)} />
        )}
      </header>

      {isDraggingFile && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-message"><Paperclip size={18} /> Fotoğrafı buraya bırak</div>
        </div>
      )}

      <div className="messages-wrapper" ref={messagesWrapperRef} onScroll={handleMessagesScroll}>
        <div className="messages-list">
          {isLoadingOlderMessages && (
            <div className="channel-status">Eski mesajlar yükleniyor…</div>
          )}
          <div className="channel-intro">
            <h2><AtSign size={28} /> {otherName}</h2>
            <p>Bu, {otherName} ile olan özel sohbetinin başlangıcı. Merhaba de!</p>
          </div>

          {messages.map((msg) => (
            <MessageItem
              key={msg.id}
              message={msg}
              currentUserId={currentUserId}
              onToggleReaction={(emoji) => toggleReaction(msg.id, emoji)}
              onEditMessage={(content) => editMessage(msg.id, content)}
              onImageClick={setLightboxUrl}
              isHighlighted={msg.id === highlightedMessageId}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="message-input-area">
        <div className="message-input-box">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
          <button
            className="attach-btn"
            onClick={handleAttachClick}
            disabled={isUploading}
            title="Dosya Ekle"
            aria-label="Dosya Ekle"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={textareaRef}
            className="message-input"
            rows={1}
            placeholder={`Message @${otherName}`}
            value={draft}
            onChange={handleDraftInputChange}
            onKeyDown={handleKeyDown}
            maxLength={4000}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={!draft.trim()}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <Send size={18} />
          </button>
        </div>

        {isUploading && <div className="upload-status">Yükleniyor…</div>}
        {uploadError && <div className="upload-status upload-status-error"><AlertTriangle size={14} /> {uploadError}</div>}

        {typingUsername && (
          <div className="typing-indicator">
            <span className="typing-dots">
              <span />
              <span />
              <span />
            </span>
            {typingUsername} yazıyor...
          </div>
        )}
      </div>

      {lightboxUrl && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={resolveFileUrl(lightboxUrl)} alt="ek büyük önizleme" className="image-lightbox-img" />
        </div>
      )}
    </main>
    {isSearchPanelOpen && (
      <SearchResultsPanel
        results={searchResults}
        isSearching={isSearching}
        onSelectMessage={(messageId) => void jumpToMessage(messageId)}
        onClose={closeSearchPanel}
      />
    )}
    </>
  );
}
