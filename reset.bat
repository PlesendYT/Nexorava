@echo off
echo === Nexorava Debug Reset ===
echo.
echo Loesche Datenbank...
if exist data.db del /f data.db
if exist data.db-shm del /f data.db-shm
if exist data.db-wal del /f data.db-wal
echo OK - Datenbank geloescht
echo.
echo Loesche hochgeladene Dateien...
if exist public\uploads\* (
  del /f /q public\uploads\*
  echo OK - Uploads geloescht
) else (
  echo Keine Uploads vorhanden
)
echo.
echo === Reset abgeschlossen ===
echo Starte die App neu mit: npm start
