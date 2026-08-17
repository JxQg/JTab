export type BookmarkKind = 'folder' | 'bookmark' | 'separator'
export type BookmarkRestriction = 'root' | 'managed' | null

export interface BookmarkNode {
  id: string
  parentId: string | null
  title: string
  url: string | null
  kind: BookmarkKind
  index: number
  depth: number
  pathIds: string[]
  childIds: string[]
  dateAdded: number | null
  folderType: string | null
  restriction: BookmarkRestriction
  selfModifiable: boolean
  childrenWritable: boolean
}

export interface BookmarkTree {
  nodes: Map<string, BookmarkNode>
  rootIds: string[]
  revision: number
}

export type FolderScope = 'subtree' | 'direct'

export interface DisplayedFolder {
  folderId: string
  scope: FolderScope
  order: number
}

export type SearchEngineId = 'google' | 'bing' | 'baidu' | 'duckduckgo' | 'custom'

export interface SearchSettings {
  engine: SearchEngineId
  customName: string
  customUrlTemplate: string
  openMode: 'current' | 'new'
}

export type BackgroundRef =
  | { kind: 'bundled'; id: string; src: string }
  | { kind: 'remote'; url: string }
  | { kind: 'local'; assetId: string }

export interface AppearanceSettings {
  background: BackgroundRef
  overlay: number
  brightness: number
  blur: number
  focalX: number
  focalY: number
  accent: string
  contentOpacity: number
  contentBlur: number
  bookmarkLayout: 'detail' | 'icon'
  bookmarkCardOpacity: number
  bookmarkDetailCardRadius: number
  bookmarkIconCardRadius: number
}

export interface CustomCssSettings {
  enabled: boolean
  code: string
}

export interface UserSettingsV2 {
  schemaVersion: 2
  displayedFolders: DisplayedFolder[]
  search: SearchSettings
  appearance: AppearanceSettings
  customCss: CustomCssSettings
}

export interface BookmarkDraft {
  parentId: string
  title: string
  url?: string
  index?: number
}

export interface BookmarkUpdate {
  title?: string
  url?: string
}

export interface BookmarkMove {
  parentId: string
  index?: number
}

export type BookmarkCapabilityReason = 'root' | 'managed' | 'missing'

export interface BookmarkCapabilities {
  canRename: boolean
  canMove: boolean
  canRemove: boolean
  canAcceptChildren: boolean
  reason: BookmarkCapabilityReason | null
}

export interface BookmarkRepository {
  getTree(): Promise<BookmarkTree>
  refresh(): Promise<BookmarkTree>
  create(draft: BookmarkDraft): Promise<BookmarkNode>
  update(id: string, changes: BookmarkUpdate): Promise<void>
  move(id: string, destination: BookmarkMove): Promise<void>
  remove(id: string, recursive: boolean): Promise<void>
  getCapabilities(id: string): Promise<BookmarkCapabilities>
  subscribe(onChange: () => void, onError?: (error: Error) => void): () => void
}
