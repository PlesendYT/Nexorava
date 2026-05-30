# Nexorava API Documentation

## Authentication

All routes that require authentication will redirect to `/login` if not logged in.
API routes return JSON with `{ error: '...' }` if unauthorized.

## Rate Limiting

- API routes: 200 requests per 15 minutes
- Login routes: 20 requests per 15 minutes

## CSRF Protection

All POST/PUT/DELETE requests (except file uploads) require a CSRF token.
Include the token in the `X-CSRF-Token` or `csrf-token` header, or as `_csrf` in the request body.
The CSRF token is available in the rendered page HTML and session.

## Endpoints

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /login | No | Login page |
| POST | /login | No | Login with username + password |
| GET | /register | No | Register page |
| POST | /register | No | Register new user |
| GET | /logout | Yes | Logout |

### Songs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | No | Homepage with song list |
| GET | /search?q=&genre=&dur=&uploader= | No | Search songs |
| GET | /song/:id/stream?q=quality | No | Stream audio (supports Range headers) |
| POST | /song/:id/play | No | Record play |
| GET | /song/:id/data | No | Get song metadata + like status |
| POST | /song/:id/like | Yes | Toggle like |
| POST | /song/:id/delete | Yes | Delete own song |
| GET | /upload | Yes | Upload page |
| POST | /upload | Yes | Upload audio file (multipart) |

### Comments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/song/:id/comments | No | Get comments for a song |
| POST | /api/song/:id/comment | Yes | Add comment |
| POST | /api/comment/:id/delete | Yes | Delete own comment |

### Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/notifications | Yes | Get notifications + unread count |
| POST | /api/notifications/read | Yes | Mark all as read |
| POST | /api/notifications/read/:id | Yes | Mark one as read |

### Reposts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/song/:id/repost | Yes | Toggle repost |
| GET | /api/reposts/:userId | No | Get reposted song IDs |

### Social

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /artist/:username | No | Artist page |
| POST | /follow/:id | Yes | Toggle follow |
| GET | /api/check-follow/:id | Yes | Check if following |
| GET | /api/likes | Yes | Get liked song IDs |
| GET | /api/likes/count/:id | No | Get like count |
| GET | /api/suggestions/:song_id | No | Get autoplay suggestions |

### Albums

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /albums | No | Public albums |
| GET | /album/:id | No | Album detail |
| POST | /album/create | Yes | Create album |
| POST | /album/:id/toggle | Yes | Toggle public/private |
| POST | /album/:id/add-song | Yes | Add song to album |
| POST | /album/:id/delete | Yes | Delete album |

### Playlists

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /playlists | No | Public playlists |
| GET | /playlist/:id | No | Playlist detail |
| POST | /playlist/create | Yes | Create playlist |
| POST | /playlist/:id/toggle | Yes | Toggle public/private |
| POST | /playlist/:id/add-song | Yes/ Collab | Add song (owner or collaborator) |
| POST | /playlist/:id/delete | Yes | Delete playlist |
| POST | /api/playlist/:id/collaborator | Yes | Manage collaborators |
| GET | /api/playlist/:id/collaborators | No | Get collaborators |
| GET | /api/user-playlists | Yes | Get user's playlists |

### Profile & Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /profile | Yes | Profile page |
| GET | /settings | Yes | Settings page |
| POST | /settings | Yes | Update settings (theme, quality) |
| POST | /settings/password | Yes | Change password |
| POST | /avatar/upload | Yes | Upload avatar (multipart) |
| POST | /account/delete | Yes | Delete account |

### Legal & Contact

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /tos | No | Terms of Service |
| GET | /privacy | No | Privacy Policy |
| GET | /upload-rules | No | Upload Guidelines |
| GET | /contact | No | Contact page |
| POST | /contact | No | Submit contact form |
| GET | /bug-report | No | Bug report page |
| POST | /bug-report | No | Submit bug report |
| GET | /copyright | No | Copyright report page |
| POST | /copyright | No | Submit copyright report |

### Moderation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /review-queue | Yes | Review queue page |
| POST | /review/:id/action | Yes | Approve/reject review |

### Sharing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /share/song/:id | No | Public share page |

### Theme

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/theme?name=dark | No | Get CSS custom properties for theme |

### Feed

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/feed | Yes | Get feed (songs + reposts from followed users) |

## Data Types

### Song
```json
{
  "id": 1,
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "genre": "Pop",
  "duration": 240,
  "plays": 100,
  "icon": "filename.png",
  "file": "/uploads/song.mp3",
  "uploader": "username",
  "premium": 0,
  "verified": 1,
  "liked": true,
  "likeCount": 5
}
```

### User
```json
{
  "id": 1,
  "username": "user",
  "email": "user@example.com",
  "premium": 0,
  "verified": 0,
  "avatar": "avatar.png",
  "stream_quality": "standard",
  "theme": "dark",
  "strikes": 0
}
```

## Streaming

Audio streaming supports:
- Range requests (seeking)
- Quality transcoding via ffmpeg (low/standard/high/original)
- Quality levels configurable per user (Premium users get high quality)

Query parameter `?q=standard` selects quality. Default is user's saved preference or `standard`.
