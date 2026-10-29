import { MarfeyxBrand } from "./brand/MarfeyxBrand";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ProgressBar,
  TextArea,
  TextField,
} from "@heroui/react";
import { strToU8, zipSync } from "fflate";
import {
  Album,
  ArrowDownToLine,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Disc3,
  File as FileIcon,
  FileAudio,
  FileCheck2,
  FileJson,
  FileWarning,
  FolderOpen,
  ImagePlus,
  Info,
  Library,
  ListMusic,
  LockKeyhole,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { emptyMetadata, readMetadata, safeFilename, TrackMetadata, writeMetadata } from "./lib/id3";

type Mode = "metadata" | "spotify";
type GeneralMetadata = {
  title: string;
  author: string;
  owner: string;
  description: string;
  category: string;
  tags: string;
  modifiedAt: string;
};
type TrackItem = {
  id: string;
  file: File;
  audioUrl: string;
  filename: string;
  extension: string;
  isMp3: boolean;
  general: GeneralMetadata;
  metadata: TrackMetadata;
  original: TrackMetadata;
  duration: number;
};

const genres = ["Alternative", "Ambient", "Blues", "Classical", "Country", "Dance", "Electronic", "Folk", "Hip-Hop", "Indie", "Jazz", "Metal", "Pop", "R&B", "Rock", "Soundtrack"];
const waveBars = [22, 42, 30, 68, 54, 82, 38, 72, 92, 56, 35, 64, 82, 44, 72, 90, 48, 28, 68, 80, 52, 38, 76, 92, 58, 44, 66, 84, 40, 70, 94, 62, 30, 58, 78, 48, 88, 64, 36, 74, 90, 55, 42, 68, 82, 34, 60, 76, 46, 24, 52, 70, 36, 58, 84, 48, 68, 90, 44, 72, 54, 32, 66, 86];

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "MP";
}

function splitFilename(name: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

function dateTimeLocal(timestamp: number) {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function generalManifest(item: TrackItem) {
  return {
    schema: "metaform-metadata-v1",
    filename: `${safeFilename(item.filename)}${item.extension}`,
    originalFilename: item.file.name,
    mediaType: item.file.type || "application/octet-stream",
    size: item.file.size,
    sourceLastModified: new Date(item.file.lastModified).toISOString(),
    metadata: {
      ...item.general,
      modifiedAt: item.general.modifiedAt ? new Date(item.general.modifiedAt).toISOString() : null,
      tags: item.general.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    },
  };
}

function App() {
  const [mode, setMode] = useState<Mode>("metadata");
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileLibrary, setMobileLibrary] = useState(false);
  const singleFileInput = useRef<HTMLInputElement>(null);
  const multiFileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const active = tracks.find((track) => track.id === activeId);

  const addFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    const accepted = mode === "spotify" ? selected.filter((file) => file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3")) : selected;
    if (!accepted.length) { setNotice(mode === "spotify" ? "Spotify mode accepts MP3 files only." : "Choose one or more files."); return; }
    const items = await Promise.all(accepted.map(async (file) => {
      const { stem, extension } = splitFilename(file.name);
      const isMp3 = file.type === "audio/mpeg" || extension.toLowerCase() === ".mp3";
      const metadata = isMp3 ? await readMetadata(file).catch(() => ({ ...emptyMetadata(), title: stem })) : { ...emptyMetadata(), title: stem };
      return {
        id: crypto.randomUUID(), file, filename: stem, extension, isMp3, metadata,
        general: {
          title: metadata.title || stem,
          author: metadata.artist,
          owner: "",
          description: metadata.comment,
          category: metadata.genre,
          tags: "",
          modifiedAt: dateTimeLocal(file.lastModified),
        },
        original: { ...metadata }, audioUrl: URL.createObjectURL(file), duration: 0,
      };
    }));
    setTracks((current) => [...current, ...items]);
    setActiveId((current) => current || items[0].id);
    setMobileLibrary(false);
    const rejected = selected.length - accepted.length;
    setNotice(`${items.length} ${items.length === 1 ? "file" : "files"} added${rejected ? `; ${rejected} non-MP3 ${rejected === 1 ? "file was" : "files were"} skipped` : ""}.`);
  };

  const updateActive = (patch: Partial<TrackItem>) => {
    setTracks((current) => current.map((track) => track.id === activeId ? { ...track, ...patch } : track));
  };

  const updateMetadata = (key: keyof TrackMetadata, value: string | boolean) => {
    if (!active) return;
    updateActive({ metadata: { ...active.metadata, [key]: value } });
  };

  const updateGeneral = (key: keyof GeneralMetadata, value: string) => {
    if (!active) return;
    updateActive({ general: { ...active.general, [key]: value } });
  };

  const removeTrack = (id: string) => {
    const index = tracks.findIndex((track) => track.id === id);
    const next = tracks.filter((track) => track.id !== id);
    const removed = tracks[index];
    if (removed) URL.revokeObjectURL(removed.audioUrl);
    setTracks(next);
    if (id === activeId) setActiveId(next[Math.min(index, next.length - 1)]?.id || "");
  };

  const exportActive = async () => {
    if (!active) return;
    if (mode === "metadata") {
      const exportedName = `${safeFilename(active.filename)}${active.extension}`;
      const archive = {
        [exportedName]: new Uint8Array(await active.file.arrayBuffer()),
        [`${safeFilename(active.filename)}.metadata.json`]: strToU8(JSON.stringify(generalManifest(active), null, 2)),
      };
      downloadBlob(new Blob([zipSync(archive, { level: 0 })], { type: "application/zip" }), `${safeFilename(active.filename)}-with-metadata.zip`);
      setNotice("File and portable metadata exported together.");
      return;
    }
    if (!active.isMp3) { setNotice("Choose an MP3 file for Spotify mode."); return; }
    const blob = await writeMetadata(active.file, active.metadata);
    const spotifyName = [active.metadata.artist, active.metadata.title].filter(Boolean).join(" - ");
    const name = mode === "spotify" && spotifyName ? spotifyName : active.filename;
    downloadBlob(blob, `${safeFilename(name)}.mp3`);
    setNotice("Tagged MP3 exported. Your original file was not changed.");
  };

  const exportAll = async () => {
    const eligible = mode === "spotify" ? tracks.filter((track) => track.isMp3) : tracks;
    if (eligible.length < 2) return;
    const archive: Record<string, Uint8Array> = {};
    for (let index = 0; index < eligible.length; index++) {
      const track = eligible[index];
      const spotifyName = [track.metadata.artist, track.metadata.title].filter(Boolean).join(" - ");
      const baseName = safeFilename(mode === "spotify" && spotifyName ? spotifyName : track.filename);
      let filename = `${baseName}${mode === "spotify" ? ".mp3" : track.extension}`;
      let copy = 2;
      while (archive[filename]) filename = `${baseName} (${copy++})${mode === "spotify" ? ".mp3" : track.extension}`;
      if (mode === "spotify") {
        const tagged = await writeMetadata(track.file, track.metadata);
        archive[filename] = new Uint8Array(await tagged.arrayBuffer());
      } else {
        archive[filename] = new Uint8Array(await track.file.arrayBuffer());
        archive[`${filename}.metadata.json`] = strToU8(JSON.stringify(generalManifest(track), null, 2));
      }
    }
    const zipped = zipSync(archive, { level: 0 });
    downloadBlob(new Blob([zipped], { type: "application/zip" }), `marfeyx-${mode === "spotify" ? "spotify-ready" : "metadata"}-${eligible.length}-files.zip`);
    setNotice(`${eligible.length} ${mode === "spotify" ? "tagged tracks" : "files with metadata"} exported in one ZIP.`);
  };

  const replaceCover = async (file?: File) => {
    if (!active || !file || !file.type.startsWith("image/")) return;
    if (active.metadata.cover) URL.revokeObjectURL(active.metadata.cover.url);
    const data = new Uint8Array(await file.arrayBuffer());
    updateMetadata("cover", { data, mime: file.type, url: URL.createObjectURL(file) } as never);
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timer);
  }, [notice]);

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode);
    if (nextMode === "spotify" && active && !active.isMp3) {
      const firstMp3 = tracks.find((track) => track.isMp3);
      if (firstMp3) setActiveId(firstMp3.id);
    }
  };

  const eligibleCount = mode === "spotify" ? tracks.filter((track) => track.isMp3).length : tracks.length;

  return (
    <div className="app-shell">
      <input ref={singleFileInput} className="hidden" type="file" accept={mode === "spotify" ? "audio/mpeg,.mp3" : undefined} onChange={(e) => e.target.files && addFiles(e.target.files)} />
      <input ref={multiFileInput} className="hidden" type="file" accept={mode === "spotify" ? "audio/mpeg,.mp3" : undefined} multiple onChange={(e) => e.target.files && addFiles(e.target.files)} />
      <input ref={coverInput} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => replaceCover(e.target.files?.[0])} />

      <header className="topbar">
        <MarfeyxBrand product="Metadata Editor" />

        <div className="mode-switch" aria-label="Editor mode">
          <button className={mode === "metadata" ? "active" : ""} onClick={() => changeMode("metadata")}>
            <Tag size={15} /> File metadata
          </button>
          <button className={mode === "spotify" ? "active spotify" : ""} onClick={() => changeMode("spotify")}>
            <SpotifyGlyph /> Spotify local
          </button>
        </div>

        <div className="top-actions">
          <div className="private-pill"><ShieldCheck size={14} /> 100% private</div>
          <HelpTooltip />
          <Button variant="secondary" size="sm" onPress={() => multiFileInput.current?.click()}><Plus size={16} /> Add files</Button>
        </div>
      </header>

      {!active ? (
        <EmptyState mode={mode} dragging={dragging} setDragging={setDragging} onFiles={addFiles} onBrowseSingle={() => singleFileInput.current?.click()} onBrowseMultiple={() => multiFileInput.current?.click()} />
      ) : (
        <main className="workspace">
          <aside className={`library-panel ${mobileLibrary ? "mobile-open" : ""}`}>
            <div className="library-heading">
              <div><span>Session</span><strong>{tracks.length} {tracks.length === 1 ? "file" : "files"}</strong></div>
              <Button isIconOnly aria-label="Add files" size="sm" variant="ghost" onPress={() => multiFileInput.current?.click()}><Plus size={16} /></Button>
            </div>
            <div className="track-list">
              {tracks.map((track) => (
                <button key={track.id} className={`track-row ${track.id === activeId ? "active" : ""}`} onClick={() => { setActiveId(track.id); setMobileLibrary(false); }}>
                  <CoverMini track={track} mode={mode} />
                  <span className="track-copy">
                    <strong>{mode === "spotify" ? track.metadata.title || track.filename : track.general.title || track.filename}</strong>
                    <small>{mode === "spotify" ? track.metadata.artist || (track.isMp3 ? "Unknown artist" : "Not an MP3") : track.extension.slice(1).toUpperCase() || track.file.type || "File"}</small>
                  </span>
                  <span className="row-more" onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }} title="Remove from session"><X size={14} /></span>
                </button>
              ))}
            </div>
            <button className="add-row" onClick={() => multiFileInput.current?.click()}><Plus size={15} /> Add more {mode === "spotify" ? "MP3s" : "files"}</button>
            <div className="local-note"><LockKeyhole size={14} /><span><strong>Local session</strong>Your files stay on this device.</span></div>
          </aside>

          <section className="editor-panel">
            <div className="editor-topline">
              <button className="mobile-library-button" onClick={() => setMobileLibrary(!mobileLibrary)}><Library size={16} /> {tracks.length} files</button>
              <div>
                <p className="eyebrow">{mode === "metadata" ? "Universal metadata" : "Spotify local files"}</p>
                <h1>{mode === "metadata" ? "Organize any file." : "Make it Spotify-ready."}</h1>
                <p>{mode === "metadata" ? "Organize identity, ownership, dates and descriptive metadata for any file." : "Polish the information Spotify reads when you import a local track."}</p>
              </div>
              <div className="saved-state"><Check size={13} /> Session saved</div>
            </div>

            {mode === "metadata" ? (
              <MetadataEditor track={active} updateTrack={updateActive} updateGeneral={updateGeneral} />
            ) : !active.isMp3 ? (
              <SpotifyUnsupported onChoose={() => singleFileInput.current?.click()} />
            ) : (
              <SpotifyEditor track={active} updateMetadata={updateMetadata} onCover={() => coverInput.current?.click()} />
            )}
          </section>

          <aside className="preview-panel">
            <TrackPreview track={active} mode={mode} updateTrack={updateActive} />
            {mode === "spotify" ? (active.isMp3 ? <SpotifyChecklist track={active} /> : <CompatibilityNote />) : <FileSummary track={active} />}
            <Button className="export-button" variant="primary" isDisabled={mode === "spotify" && !active.isMp3} onPress={exportActive}>
              <ArrowDownToLine size={17} /> {mode === "spotify" ? "Export Spotify-ready MP3" : "Export file + metadata"}
            </Button>
            {eligibleCount > 1 && <Button className="export-all-button" variant="secondary" onPress={exportAll}><Library size={16} /> Export all {eligibleCount} as ZIP</Button>}
            <p className="export-note"><ShieldCheck size={12} /> Nothing is uploaded. Export happens locally.</p>
          </aside>
        </main>
      )}

      {notice && <div className="toast"><span><Check size={15} /></span>{notice}<button onClick={() => setNotice(null)}><X size={14} /></button></div>}
    </div>
  );
}

function EmptyState({ mode, dragging, setDragging, onFiles, onBrowseSingle, onBrowseMultiple }: { mode: Mode; dragging: boolean; setDragging: (value: boolean) => void; onFiles: (files: FileList) => void; onBrowseSingle: () => void; onBrowseMultiple: () => void }) {
  return (
    <main className="empty-page">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="empty-copy">
        <Chip color={mode === "spotify" ? "success" : "accent"} variant="soft" size="sm">
          <Sparkles size={13} /> {mode === "spotify" ? "Built for Spotify Local Files" : "Private by design"}
        </Chip>
        <h1>{mode === "spotify" ? <>Your music.<br /><em>Spotify, polished.</em></> : <>File metadata,<br /><em>beautifully organized.</em></>}</h1>
        <p>{mode === "spotify" ? "Prepare clean titles, artist credits, albums and artwork before adding your tracks to Spotify." : "Rename and document any local file with clean ownership, dates, descriptions, categories and portable metadata."}</p>
        <div className="trust-row"><span><Check size={14} /> No account</span><span><Check size={14} /> Browser-only</span><span><Check size={14} /> Original bytes preserved</span></div>
      </section>

      <section
        className={`drop-card ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
      >
        <div className="drop-visual">
          <div className="file-sheet back">{mode === "spotify" ? <Music2 size={20} /> : <FileJson size={20} />}</div>
          <div className="file-sheet front">{mode === "spotify" ? <FileAudio size={28} /> : <FileIcon size={28} />}<span>{mode === "spotify" ? "MP3" : "FILE"}</span></div>
          <div className="upload-orb"><UploadCloud size={20} /></div>
        </div>
        <h2>Drop your {mode === "spotify" ? "music" : "files"} here</h2>
        <p>One file or an entire selection</p>
        <div className="file-choice-actions">
          <Button variant="primary" size="lg" onPress={onBrowseSingle}><FolderOpen size={18} /> Choose one {mode === "spotify" ? "MP3" : "file"}</Button>
          <Button variant="secondary" size="lg" onPress={onBrowseMultiple}><Library size={17} /> Select multiple</Button>
        </div>
        <small>{mode === "spotify" ? "MP3 only" : "Any file type"} · files are processed on your device</small>
      </section>

      <section className="feature-strip">
        <article><span><WandSparkles size={18} /></span><div><strong>{mode === "spotify" ? "Clean music tags" : "Universal organization"}</strong><p>{mode === "spotify" ? "Titles, artists, albums, genres and more." : "Names, owners, dates, descriptions and tags."}</p></div></article>
        <article><span>{mode === "spotify" ? <ImagePlus size={18} /> : <FileJson size={18} />}</span><div><strong>{mode === "spotify" ? "Artwork included" : "Portable sidecars"}</strong><p>{mode === "spotify" ? "Embed high-quality cover art directly." : "Keep metadata readable without altering file data."}</p></div></article>
        <article><span><ShieldCheck size={18} /></span><div><strong>Completely private</strong><p>Your files never leave this browser.</p></div></article>
      </section>
      <footer className="empty-footer">
        <span>Marfeyx Metadata Editor Studio</span>
        <a href="mailto:dev@marfeyx.ch">dev@marfeyx.ch</a>
        <span>Designed for independent sound.</span>
      </footer>
    </main>
  );
}

function MetadataEditor({ track, updateTrack, updateGeneral }: { track: TrackItem; updateTrack: (patch: Partial<TrackItem>) => void; updateGeneral: (key: keyof GeneralMetadata, value: string) => void }) {
  return (
    <div className="editor-stack">
      <Card variant="secondary" className="universal-intro">
        <Card.Content><FileJson size={18} /><div><strong>Universal metadata workspace</strong><p>The original file data stays intact. Your edits are packaged in a readable JSON sidecar that travels with the renamed file.</p></div><Chip color="accent" variant="soft" size="sm">Any format</Chip></Card.Content>
      </Card>

      <EditorCard icon={<FileIcon size={17} />} title="File identity" description="Rename the exported file and review its source properties.">
        <div className="field-grid">
          <Field label="Exported filename" value={track.filename} onChange={(value) => updateTrack({ filename: value })} suffix={track.extension} />
          <ReadonlyField label="Original filename" value={track.file.name} />
          <ReadonlyField label="Source last modified" value={new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(track.file.lastModified)} icon={<Clock3 size={14} />} />
          <ReadonlyField label="File size" value={formatBytes(track.file.size)} />
          <ReadonlyField label="Media type" value={track.file.type || "Unknown / binary"} />
          <ReadonlyField label="Extension" value={track.extension || "No extension"} />
        </div>
      </EditorCard>

      <EditorCard icon={<Tag size={17} />} title="Descriptive metadata" description="Portable details for organizing, cataloging and identifying this file.">
        <div className="field-grid">
          <Field label="Display title" value={track.general.title} onChange={(value) => updateGeneral("title", value)} placeholder="Human-readable title" />
          <Field label="Author / creator" value={track.general.author} onChange={(value) => updateGeneral("author", value)} placeholder="Person or organization" />
          <Field label="Owner / rights holder" value={track.general.owner} onChange={(value) => updateGeneral("owner", value)} placeholder="Optional" />
          <Field label="Category" value={track.general.category} onChange={(value) => updateGeneral("category", value)} placeholder="Document, design, archive…" />
          <Field label="Documented modified date" type="datetime-local" value={track.general.modifiedAt} onChange={(value) => updateGeneral("modifiedAt", value)} />
          <Field label="Tags" value={track.general.tags} onChange={(value) => updateGeneral("tags", value)} placeholder="project, final, client" />
          <TextField className="field wide" name="description">
            <Label>Description / notes</Label>
            <TextArea variant="secondary" rows={4} value={track.general.description} onChange={(e) => updateGeneral("description", e.target.value)} placeholder="Describe the file, its purpose, source or usage rights…" />
          </TextField>
        </div>
      </EditorCard>
    </div>
  );
}

function SpotifyUnsupported({ onChoose }: { onChoose: () => void }) {
  return (
    <Card className="unsupported-card" variant="default">
      <Card.Content><span><FileWarning size={26} /></span><h2>Spotify mode needs an MP3</h2><p>This file remains available in Metadata mode. Choose an MP3 to edit embedded Spotify-facing tags and cover artwork.</p><Button variant="primary" onPress={onChoose}><FileAudio size={16} /> Choose an MP3</Button></Card.Content>
    </Card>
  );
}

function SpotifyEditor({ track, updateMetadata, onCover }: { track: TrackItem; updateMetadata: (key: keyof TrackMetadata, value: string | boolean) => void; onCover: () => void }) {
  const required = [track.metadata.title, track.metadata.artist, track.metadata.album, track.metadata.year, track.metadata.genre, track.metadata.cover];
  const score = Math.round(required.filter(Boolean).length / required.length * 100);
  return (
    <div className="editor-stack">
      <Card variant="secondary" className="spotify-intro">
        <Card.Content>
          <span className="spotify-badge"><SpotifyGlyph /></span>
          <div><strong>Local Files preparation</strong><p>Spotify reads embedded tags from your MP3. Complete these fields, export the file, then add its folder in Spotify settings.</p></div>
          <Chip color={score === 100 ? "success" : "warning"} variant="soft" size="sm">{score}% complete</Chip>
        </Card.Content>
      </Card>

      <EditorCard icon={<ListMusic size={17} />} title="Release details" description="How this track will appear in your Spotify library.">
        <div className="field-grid">
          <Field label="Track title" value={track.metadata.title} onChange={(value) => updateMetadata("title", value)} placeholder="Required" required />
          <Field label="Primary artist" value={track.metadata.artist} onChange={(value) => updateMetadata("artist", value)} placeholder="Required" required />
          <Field label="Release / album" value={track.metadata.album} onChange={(value) => updateMetadata("album", value)} placeholder="Required" required />
          <Field label="Album artist" value={track.metadata.albumArtist} onChange={(value) => updateMetadata("albumArtist", value)} placeholder="Usually the primary artist" />
          <GenreField value={track.metadata.genre} onChange={(value) => updateMetadata("genre", value)} required />
          <Field label="Release year" value={track.metadata.year} onChange={(value) => updateMetadata("year", value.replace(/\D/g, "").slice(0, 4))} placeholder="2026" required />
          <Field label="Track number" value={track.metadata.track} onChange={(value) => updateMetadata("track", value)} placeholder="1 or 1/12" />
          <Field label="Disc number" value={track.metadata.disc} onChange={(value) => updateMetadata("disc", value)} placeholder="1 or 1/2" />
        </div>
        <div className="explicit-row">
          <button className={`toggle ${track.metadata.explicit ? "on" : ""}`} onClick={() => updateMetadata("explicit", !track.metadata.explicit)} aria-label="Toggle explicit content"><span /></button>
          <div><strong>Explicit content</strong><p>Mark this track with an explicit-content advisory tag.</p></div>
          <Chip color={track.metadata.explicit ? "warning" : "default"} variant="soft" size="sm">{track.metadata.explicit ? "Explicit" : "Clean"}</Chip>
        </div>
      </EditorCard>

      <ArtworkCard track={track} onCover={onCover} onRemove={() => updateMetadata("cover", undefined as never)} spotify />
    </div>
  );
}

function EditorCard({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="editor-card" variant="default">
      <Card.Header><span className="section-icon">{icon}</span><div><Card.Title>{title}</Card.Title><Card.Description>{description}</Card.Description></div></Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder, suffix, wide, required, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; suffix?: string; wide?: boolean; required?: boolean; type?: string }) {
  return (
    <TextField className={`field ${wide ? "wide" : ""}`} name={label.toLowerCase().replace(/\s+/g, "-")} isRequired={required}>
      <Label>{label}</Label>
      <div className="input-wrap"><Input variant="secondary" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />{suffix && <span>{suffix}</span>}</div>
    </TextField>
  );
}

function ReadonlyField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div className="readonly-field"><label>{label}</label><div>{icon}{value}</div></div>;
}

function GenreField({ value, onChange, required }: { value: string; onChange: (value: string) => void; required?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field genre-field">
      <label>{labelWithRequired("Genre", required)}</label>
      <button className="genre-trigger" onClick={() => setOpen(!open)}><span className={!value ? "placeholder" : ""}>{value || "Choose a genre"}</span><ChevronDown size={15} /></button>
      {open && <div className="genre-menu">{genres.map((genre) => <button key={genre} className={genre === value ? "active" : ""} onClick={() => { onChange(genre); setOpen(false); }}>{genre}{genre === value && <Check size={13} />}</button>)}</div>}
    </div>
  );
}

function labelWithRequired(label: string, required?: boolean) { return <>{label}{required && <span className="required"> *</span>}</>; }

function ArtworkCard({ track, onCover, onRemove, spotify }: { track: TrackItem; onCover: () => void; onRemove: () => void; spotify?: boolean }) {
  return (
    <EditorCard icon={<ImagePlus size={17} />} title="Cover artwork" description={spotify ? "Square artwork looks best in Spotify's library and player." : "Embed a visual identity directly inside the MP3."}>
      <div className="artwork-editor">
        <div className={`artwork-box ${track.metadata.cover ? "has-cover" : ""}`} onClick={onCover}>
          {track.metadata.cover ? <img src={track.metadata.cover.url} alt="Cover preview" /> : <><Disc3 size={30} /><span>No artwork</span></>}
          <div className="artwork-hover"><ImagePlus size={18} /> Replace</div>
        </div>
        <div className="artwork-copy">
          <strong>{track.metadata.cover ? "Artwork embedded" : "Add cover artwork"}</strong>
          <p>JPG, PNG or WebP. For the sharpest result, use a square image at least 640 × 640 px.</p>
          <div><Button variant="secondary" size="sm" onPress={onCover}><ImagePlus size={15} /> {track.metadata.cover ? "Replace" : "Choose image"}</Button>{track.metadata.cover && <Button variant="ghost" size="sm" onPress={onRemove}><Trash2 size={15} /> Remove</Button>}</div>
        </div>
        <div className="artwork-spec"><span>Recommended</span><strong>1:1</strong><small>Square ratio</small></div>
      </div>
    </EditorCard>
  );
}

function TrackPreview({ track, mode, updateTrack }: { track: TrackItem; mode: Mode; updateTrack: (patch: Partial<TrackItem>) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  useEffect(() => { setPlaying(false); setPosition(0); audio.current?.load(); }, [track.id]);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const update = () => setPosition(el.currentTime);
    el.addEventListener("timeupdate", update);
    return () => el.removeEventListener("timeupdate", update);
  }, [track.id]);
  const toggle = async () => {
    const el = audio.current; if (!el) return;
    if (playing) el.pause(); else await el.play();
    setPlaying(!playing);
  };
  if (mode === "metadata" || !track.isMp3) {
    const isImage = track.file.type.startsWith("image/");
    return (
      <Card className="preview-card file-preview" variant="tertiary">
        <Card.Header><div><Card.Title>File preview</Card.Title><Card.Description>{mode === "metadata" ? "Universal metadata package" : "Not compatible with Spotify mode"}</Card.Description></div><MoreHorizontal size={18} /></Card.Header>
        <Card.Content>
          <div className={`generic-file-visual ${isImage ? "is-image" : ""}`}>
            {isImage ? <img src={track.audioUrl} alt="File preview" /> : <><FileIcon size={76} /><span>{track.extension.slice(1).toUpperCase() || "FILE"}</span></>}
          </div>
          <div className="preview-title"><strong>{track.general.title || track.filename}</strong><span>{track.general.author || track.general.owner || "No creator specified"}</span><small>{track.filename}{track.extension}</small></div>
          <div className="metadata-package-row">{mode === "metadata" ? <FileJson size={15} /> : <FileWarning size={15} />}<div><strong>{mode === "metadata" ? "Sidecar ready" : "MP3 required"}</strong><span>{mode === "metadata" ? "Portable JSON metadata" : "Use File metadata for this item"}</span></div>{mode === "metadata" && <Check size={14} />}</div>
        </Card.Content>
      </Card>
    );
  }
  return (
    <Card className={`preview-card ${mode === "spotify" ? "spotify-preview" : ""}`} variant="tertiary">
      <Card.Header><div><Card.Title>{mode === "spotify" ? "Spotify preview" : "Now editing"}</Card.Title><Card.Description>{mode === "spotify" ? "Approximate library appearance" : "Listen before you export"}</Card.Description></div><MoreHorizontal size={18} /></Card.Header>
      <Card.Content>
        <div className="cover-large">
          {track.metadata.cover ? <img src={track.metadata.cover.url} alt="Track cover" /> : <div className="cover-placeholder"><span>{initials(track.metadata.artist || track.metadata.title)}</span><Disc3 size={80} /></div>}
          {mode === "spotify" && <span className="spotify-corner"><SpotifyGlyph /></span>}
        </div>
        <div className="preview-title"><strong>{track.metadata.title || "Untitled track"}</strong><span>{track.metadata.artist || "Unknown artist"}</span>{track.metadata.album && <small>{track.metadata.album}</small>}</div>
        <audio ref={audio} src={track.audioUrl} preload="metadata" onLoadedMetadata={(e) => updateTrack({ duration: e.currentTarget.duration })} onEnded={() => setPlaying(false)} />
        <div className="player">
          <button onClick={toggle}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
          <div className="waveform" onClick={(e) => { const el = audio.current; if (!el || !track.duration) return; const ratio = e.nativeEvent.offsetX / e.currentTarget.clientWidth; el.currentTime = ratio * track.duration; }}>
            {waveBars.map((height, i) => <span key={i} className={(i / waveBars.length) * track.duration <= position ? "played" : ""} style={{ height: `${height}%` }} />)}
          </div>
          <small>{formatTime(track.duration)}</small>
        </div>
      </Card.Content>
    </Card>
  );
}

function FileSummary({ track }: { track: TrackItem }) {
  return (
    <Card className="summary-card" variant="default">
      <Card.Header><Card.Title>File overview</Card.Title></Card.Header>
      <Card.Content>
        <SummaryRow label="Size" value={formatBytes(track.file.size)} />
        <SummaryRow label="Type" value={track.file.type || "Unknown"} />
        <SummaryRow label="Extension" value={track.extension || "None"} />
        <SummaryRow label="Metadata output" value="JSON sidecar" />
      </Card.Content>
    </Card>
  );
}

function CompatibilityNote() {
  return (
    <Card className="summary-card compatibility-note" variant="default">
      <Card.Content><Info size={15} /><p>Only MP3 files can be prepared in Spotify mode. Switch back to Metadata to keep working with this file.</p></Card.Content>
    </Card>
  );
}

function SpotifyChecklist({ track }: { track: TrackItem }) {
  const items = [
    { label: "Title & artist", done: !!(track.metadata.title && track.metadata.artist) },
    { label: "Release details", done: !!(track.metadata.album && track.metadata.year) },
    { label: "Square artwork", done: !!track.metadata.cover },
  ];
  return (
    <Card className="summary-card spotify-checklist" variant="default">
      <Card.Header><div><Card.Title>Ready check</Card.Title><Card.Description>Before adding to Spotify</Card.Description></div></Card.Header>
      <Card.Content>
        {items.map((item) => <div className="check-row" key={item.label}><span className={item.done ? "done" : ""}>{item.done ? <Check size={12} /> : <span />}</span><strong>{item.label}</strong><small>{item.done ? "Ready" : "Missing"}</small></div>)}
        <div className="spotify-steps"><Info size={14} /><p>After export: open Spotify desktop → Settings → Library → enable <strong>Local Files</strong> and add the export folder.</p></div>
      </Card.Content>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) { return <div className="summary-row"><span>{label}</span><strong>{value}</strong></div>; }
function CoverMini({ track, mode }: { track: TrackItem; mode: Mode }) {
  if (mode === "spotify" && track.metadata.cover) return <img className="cover-mini" src={track.metadata.cover.url} alt="" />;
  return <span className="cover-mini empty">{mode === "spotify" && track.isMp3 ? <Music2 size={15} /> : <FileIcon size={15} />}<small>{mode === "metadata" ? track.extension.slice(1, 5).toUpperCase() : ""}</small></span>;
}
function HelpTooltip() {
  return (
    <span className="help-tooltip">
      <Button isIconOnly aria-label="Privacy information" aria-describedby="privacy-tooltip" variant="ghost" size="sm"><CircleHelp size={17} /></Button>
      <span id="privacy-tooltip" role="tooltip"><LockKeyhole size={12} /> Files never leave your browser.</span>
    </span>
  );
}
function SpotifyGlyph() { return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 1.75A10.25 10.25 0 1 0 12 22.25 10.25 10.25 0 0 0 12 1.75Zm4.7 14.77a.64.64 0 0 1-.88.21c-2.42-1.48-5.46-1.81-9.04-.99a.64.64 0 0 1-.29-1.25c3.92-.9 7.29-.52 10 1.14.3.18.39.58.21.89Zm1.26-2.8a.8.8 0 0 1-1.1.26c-2.77-1.7-7-2.19-10.28-1.2a.8.8 0 1 1-.46-1.53c3.75-1.13 8.42-.58 11.58 1.36.38.23.5.73.26 1.1Zm.1-2.92C14.74 8.83 9.25 8.65 6.08 9.6a.96.96 0 1 1-.55-1.84c3.64-1.09 9.7-.88 13.5 1.38a.96.96 0 0 1-.98 1.66Z" /></svg>; }

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export default App;
