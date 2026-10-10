"""Pack the built extension into a .vsix (a zip) without the vsce tool.

A VSIX holds two XML files that describe the package, and the extension itself
under `extension/`. Output goes to %LOCALAPPDATA%\\Teto\\vsix (outside OneDrive).
Install with: code --install-extension <the .vsix> --force
"""

import json
import os
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent.parent  # typescript/vscode
REPO = HERE.parent.parent
INCLUDE = ["out", "media", "static"]  # built and static files; never node_modules or sources
SKIP_SUFFIXES = {".map", ".ts"}
TYPES = {".js": "application/javascript", ".json": "application/json", ".css": "text/css",
         ".svg": "image/svg+xml", ".wasm": "application/wasm", ".md": "text/markdown",
         ".txt": "text/plain", ".vsixmanifest": "text/xml"}


def manifest(pkg: dict) -> str:
    v = {k: escape(str(pkg[k]), {'"': "&quot;"}) for k in ("name", "version", "publisher", "displayName", "description")}
    engine = escape(pkg["engines"]["vscode"], {'"': "&quot;"})
    return f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{v['name']}" Version="{v['version']}" Publisher="{v['publisher']}" />
    <DisplayName>{v['displayName']}</DisplayName>
    <Description xml:space="preserve">{v['description']}</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{engine}" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
"""


def content_types(suffixes: set[str]) -> str:
    rows = "".join(f'<Default Extension="{s}" ContentType="{TYPES[s]}"/>' for s in sorted(suffixes))
    return f'<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{rows}</Types>'


def files() -> list[tuple[Path, str]]:
    """(source file, path inside the zip) for everything the extension needs at run time."""
    out = [(HERE / "package.json", "extension/package.json"),
           (HERE / "README.md", "extension/README.md"),
           (REPO / "LICENSE", "extension/LICENSE.txt"),
           (REPO / "NOTICE.md", "extension/NOTICE.md")]
    for d in INCLUDE:
        for p in sorted((HERE / d).rglob("*")):
            if p.is_file() and p.suffix not in SKIP_SUFFIXES:
                out.append((p, "extension/" + p.relative_to(HERE).as_posix()))
    return out


def main() -> Path:
    pkg = json.loads((HERE / "package.json").read_text(encoding="utf-8"))
    entries = files()
    unknown = {Path(arc).suffix for _, arc in entries} - TYPES.keys()
    if unknown:
        raise SystemExit(f"no content type for {sorted(unknown)}; add it to TYPES")
    dest = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Teto" / "vsix"
    dest.mkdir(parents=True, exist_ok=True)
    vsix = dest / f"{pkg['publisher']}.{pkg['name']}-{pkg['version']}.vsix"
    with zipfile.ZipFile(vsix, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("extension.vsixmanifest", manifest(pkg))
        z.writestr("[Content_Types].xml", content_types({Path(a).suffix for _, a in entries} | {".vsixmanifest"}))
        for src, arc in entries:
            z.write(src, arc)
    # Self-check: the parts VS Code needs are really in the zip.
    with zipfile.ZipFile(vsix) as z:
        names = set(z.namelist())
    main_js = "extension/" + pkg["main"].removeprefix("./")
    for need in ("extension.vsixmanifest", "[Content_Types].xml", "extension/package.json", main_js,
                 "extension/out/webview.js", "extension/media/physics.wasm"):
        assert need in names, f"{need} missing from {vsix.name}"
    print(f"packed {len(names)} files -> {vsix}")
    return vsix


if __name__ == "__main__":
    main()
