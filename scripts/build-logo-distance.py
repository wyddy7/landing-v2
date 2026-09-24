#!/usr/bin/env python3
"""Bake the padded 16-bit signed-distance field used by the glass logo.

Usage:
    python3 landing/scripts/build-logo-distance.py
    python3 landing/scripts/build-logo-distance.py --output landing/assets/logo/logo-distance.png

Dependencies: Python 3, Pillow 11.3+, and librsvg's ``rsvg-convert``.
The defaults are intentionally fixed to the values in assets/logo/optical-shader.js:
the 1024 px source is placed in a 1024 px domain with domain size 2.3.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from array import array
from io import BytesIO
from pathlib import Path

from PIL import Image


SIZE = 1024
DOMAIN = 2.3
DISTANCE_RANGE = 4.0
WEIGHTS = (1, 4, 6, 4, 1)
INF = 1e6
DEFAULT_SOURCE = Path(__file__).resolve().parents[1] / "assets" / "favicon-light.svg"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "logo" / "logo-distance.png"
DEFAULT_RSVG = "rsvg-convert"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def source_with_main_path(source: Path) -> tuple[bytes, int, str]:
    """Serialize the original SVG after removing every path but the longest one."""
    tree = ET.parse(source)
    root = tree.getroot()
    paths = [
        element
        for element in root.iter()
        if local_name(element.tag) == "path" and "d" in element.attrib
    ]
    if not paths:
        raise ValueError(f"No SVG path elements found in {source}")
    main = max(paths, key=lambda element: len(element.attrib["d"]))
    main_length = len(main.attrib["d"])

    for parent in root.iter():
        for child in list(parent):
            if child in paths and child is not main:
                parent.remove(child)

    # The original file has a default SVG namespace. Registering it avoids
    # changing the rendered document into an arbitrary ns0-prefixed variant.
    namespace = root.tag.partition("}")[0].lstrip("{")
    if namespace:
        ET.register_namespace("", namespace)
    output = BytesIO()
    tree.write(output, encoding="utf-8", xml_declaration=True)
    return output.getvalue(), main_length, root.get("viewBox", "")


def render_alpha(source: Path, rsvg_convert: str) -> tuple[Image.Image, int, str]:
    """Render the main source path at 1024 px, then apply browser drawImage padding."""
    svg, main_length, view_box = source_with_main_path(source)
    with tempfile.NamedTemporaryFile(prefix="logo-distance-", suffix=".svg") as handle:
        handle.write(svg)
        handle.flush()
        command = [
            rsvg_convert,
            "--format",
            "png",
            "--width",
            str(SIZE),
            "--height",
            str(SIZE),
            handle.name,
        ]
        try:
            rendered = subprocess.run(
                command,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            ).stdout
        except FileNotFoundError as error:
            raise RuntimeError(
                f"Cannot find rsvg-convert at {rsvg_convert!r}; use --rsvg-convert"
            ) from error
        except subprocess.CalledProcessError as error:
            detail = error.stderr.decode("utf-8", "replace").strip()
            raise RuntimeError(f"rsvg-convert failed: {detail}") from error

    rendered_image = Image.open(BytesIO(rendered)).convert("RGBA")
    if rendered_image.size != (SIZE, SIZE):
        raise RuntimeError(f"rsvg-convert returned {rendered_image.size}, expected 1024x1024")

    # This approximates the browser's drawImage padding step:
    # source SVG pixels are rasterized at 1024 first, then linearly filtered
    # into the 2/domain square. Rasterizer edge coverage may differ by subpixels from browser Canvas.
    scale = 2.0 / DOMAIN
    offset = (SIZE - SIZE * scale) / 2.0
    alpha = rendered_image.getchannel("A")
    padded_alpha = alpha.transform(
        (SIZE, SIZE),
        Image.Transform.AFFINE,
        (1.0 / scale, 0.0, -offset / scale, 0.0, 1.0 / scale, -offset / scale),
        resample=Image.Resampling.BILINEAR,
        fillcolor=0,
    )
    return padded_alpha, main_length, view_box


def chamfer(field: array) -> None:
    """Match the two in-place 3x3 chamfer passes from optical-shader.js."""
    diagonal = math.sqrt(2.0)
    for y in range(SIZE):
        row = y * SIZE
        for x in range(SIZE):
            i = row + x
            value = field[i]
            if x:
                value = min(value, field[i - 1] + 1.0)
            if y:
                value = min(value, field[i - SIZE] + 1.0)
            if x and y:
                value = min(value, field[i - SIZE - 1] + diagonal)
            if x < SIZE - 1 and y:
                value = min(value, field[i - SIZE + 1] + diagonal)
            field[i] = value

    for y in range(SIZE - 1, -1, -1):
        row = y * SIZE
        for x in range(SIZE - 1, -1, -1):
            i = row + x
            value = field[i]
            if x < SIZE - 1:
                value = min(value, field[i + 1] + 1.0)
            if y < SIZE - 1:
                value = min(value, field[i + SIZE] + 1.0)
            if x < SIZE - 1 and y < SIZE - 1:
                value = min(value, field[i + SIZE + 1] + diagonal)
            if x and y < SIZE - 1:
                value = min(value, field[i + SIZE - 1] + diagonal)
            field[i] = value


def blur(signed: array) -> array:
    """Apply the shader's horizontal then vertical 5-tap blur."""
    for pass_index in range(2):
        filtered = array("f", [0.0]) * (SIZE * SIZE)
        for y in range(SIZE):
            for x in range(SIZE):
                total = 0.0
                for k, weight in zip(range(-2, 3), WEIGHTS):
                    sx = max(0, min(SIZE - 1, x + k)) if pass_index == 0 else x
                    sy = max(0, min(SIZE - 1, y + k)) if pass_index == 1 else y
                    total += signed[sy * SIZE + sx] * weight
                filtered[y * SIZE + x] = total / 16.0
        signed = filtered
    return signed


def encode_distance(alpha: Image.Image) -> bytes:
    """Build RG16 SDF bytes; blue is zero and alpha is opaque by contract."""
    pixels = alpha.tobytes()
    inside = array("f", [0.0]) * (SIZE * SIZE)
    outside = array("f", [0.0]) * (SIZE * SIZE)
    for i, value in enumerate(pixels):
        coverage = value / 255.0
        if coverage < 0.5:
            inside[i] = 0.0
        elif coverage < 1.0:
            inside[i] = coverage - 0.5
        else:
            inside[i] = INF

        if coverage >= 0.5:
            outside[i] = 0.0
        elif coverage > 0.0:
            outside[i] = 0.5 - coverage
        else:
            outside[i] = INF

    chamfer(inside)
    chamfer(outside)
    signed = array("f", [0.0]) * (SIZE * SIZE)
    for i in range(SIZE * SIZE):
        signed[i] = (outside[i] - inside[i]) * DOMAIN / SIZE
    signed = blur(signed)

    output = bytearray(SIZE * SIZE * 4)
    for i, distance in enumerate(signed):
        encoded = max(0.0, min(1.0, distance / DISTANCE_RANGE + 0.5))
        value = int(math.floor(encoded * 65535.0 + 0.5))
        output[i * 4] = value >> 8
        output[i * 4 + 1] = value & 255
        # B remains zero; A is opaque so the texture is sampled as RG data.
        output[i * 4 + 3] = 255
    return bytes(output)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Original favicon SVG")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output RGBA PNG")
    parser.add_argument(
        "--rsvg-convert",
        default=DEFAULT_RSVG,
        help=f"rsvg-convert executable (default: {DEFAULT_RSVG})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.source.is_file():
        raise SystemExit(f"Source SVG does not exist: {args.source}")
    alpha, main_length, view_box = render_alpha(args.source, args.rsvg_convert)
    data = encode_distance(alpha)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image = Image.frombytes("RGBA", (SIZE, SIZE), data)
    # Explicitly omit ICC/text metadata. PNG compression is fixed for a stable artifact.
    image.save(args.output, format="PNG", compress_level=9, optimize=False)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    print(f"source_dimensions: {SIZE}x{SIZE}; viewBox: {view_box or 'unspecified'}")
    print(f"main_path_d_length: {main_length}")
    print(f"output: {args.output}")
    print(f"output_sha256: {digest}")
    print(f"output_bytes: {args.output.stat().st_size}")


if __name__ == "__main__":
    main()
