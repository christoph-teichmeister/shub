// The knowledge base note a terminal link asked the notes panel to show (null: the session's own draft).
export const noteFile = $state<{ target: { file: string; url: string | null } | null }>({ target: null });
