#!/usr/bin/env python3
"""Generate Clawchestra app icons from the logo PNG."""

from PIL import Image, ImageDraw
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(REPO, 'assets')
ICONS_DIR = os.path.join(REPO, 'src-tauri', 'icons')
BRAND_COLOR = (0xDF, 0xFF, 0x00)  # #DFFF00

def recolor_white_to_brand(img):
    """Replace white/light pixels with brand color, keep transparency."""
    img = img.convert('RGBA')
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0:
                # Use the luminance of the original pixel to modulate the brand color
                lum = (r + g + b) / (3 * 255.0)
                pixels[x, y] = (
                    int(BRAND_COLOR[0] * lum),
                    int(BRAND_COLOR[1] * lum),
                    int(BRAND_COLOR[2] * lum),
                    a,
                )
    return img


def recolor_black_to_brand(img):
    """Replace black/dark pixels with brand color, keep transparency."""
    img = img.convert('RGBA')
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0:
                # Invert: darker pixels become brighter brand color
                lum = 1.0 - (r + g + b) / (3 * 255.0)
                pixels[x, y] = (
                    int(BRAND_COLOR[0] * lum),
                    int(BRAND_COLOR[1] * lum),
                    int(BRAND_COLOR[2] * lum),
                    a,
                )
    return img


def create_rounded_rect_mask(size, radius):
    """Create a rounded rectangle mask."""
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size[0]-1, size[1]-1], radius=radius, fill=255)
    return mask


def create_app_icon(size=1024):
    """Create the app icon: rounded square with border gradient + centered logo."""
    # Create base canvas
    icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    
    corner_radius = int(size * 0.22)  # macOS-style rounded corners
    
    # Draw outer rounded rect (brand color border)
    draw.rounded_rectangle(
        [0, 0, size-1, size-1],
        radius=corner_radius,
        fill=BRAND_COLOR + (255,),
    )
    
    # Draw inner rounded rect (dark fill)
    border = int(size * 0.06)  # Border width
    inner_radius = max(1, corner_radius - border)
    draw.rounded_rectangle(
        [border, border, size-1-border, size-1-border],
        radius=inner_radius,
        fill=(24, 24, 27, 255),  # neutral-900
    )
    
    # Load and recolor the black logo to brand color
    logo_path = os.path.join(ASSETS, 'Clawchestra.png')
    logo = Image.open(logo_path).convert('RGBA')
    logo_colored = recolor_black_to_brand(logo)
    
    # Scale logo to fit inner area with padding
    inner_size = size - 2 * border
    padding = int(inner_size * 0.12)
    max_logo_size = inner_size - 2 * padding
    
    # Maintain aspect ratio
    logo_w, logo_h = logo_colored.size
    scale = min(max_logo_size / logo_w, max_logo_size / logo_h)
    new_w = int(logo_w * scale)
    new_h = int(logo_h * scale)
    logo_resized = logo_colored.resize((new_w, new_h), Image.LANCZOS)
    
    # Center logo in the icon
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    
    # Composite logo onto icon
    icon.paste(logo_resized, (x, y), logo_resized)
    
    # Apply rounded rect mask to the whole icon
    mask = create_rounded_rect_mask((size, size), corner_radius)
    icon.putalpha(mask)
    
    return icon


def main():
    print("Generating Clawchestra icons...")
    
    # Generate main icon at 1024px
    icon_1024 = create_app_icon(1024)
    
    # Save brand-colored logo variants
    white_logo = Image.open(os.path.join(ASSETS, 'Clawchestra White.png'))
    black_logo = Image.open(os.path.join(ASSETS, 'Clawchestra.png'))
    
    brand_from_white = recolor_white_to_brand(white_logo)
    brand_from_black = recolor_black_to_brand(black_logo)
    
    brand_from_white.save(os.path.join(ASSETS, 'clawchestra-brand.png'))
    brand_from_black.save(os.path.join(ASSETS, 'clawchestra-brand-from-black.png'))
    print("  Saved brand-colored variants to assets/")
    
    # Save Tauri icons at all required sizes
    tauri_sizes = {
        'icon-1024.png': 1024,
        'icon-512.png': 512,
        'icon.png': 512,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        '64x64.png': 64,
        '32x32.png': 32,
    }
    
    # Windows icons
    windows_sizes = {
        'Square310x310Logo.png': 310,
        'Square284x284Logo.png': 284,
        'Square150x150Logo.png': 150,
        'Square142x142Logo.png': 142,
        'Square107x107Logo.png': 107,
        'Square89x89Logo.png': 89,
        'Square71x71Logo.png': 71,
        'Square44x44Logo.png': 44,
        'Square30x30Logo.png': 30,
        'StoreLogo.png': 50,
    }
    
    all_sizes = {**tauri_sizes, **windows_sizes}
    
    for filename, size in all_sizes.items():
        resized = icon_1024.resize((size, size), Image.LANCZOS)
        resized.save(os.path.join(ICONS_DIR, filename))
    
    print(f"  Saved {len(all_sizes)} icon sizes to src-tauri/icons/")
    
    # Generate .ico (Windows)
    ico_sizes = [256, 128, 64, 48, 32, 16]
    ico_images = [icon_1024.resize((s, s), Image.LANCZOS) for s in ico_sizes]
    ico_images[0].save(
        os.path.join(ICONS_DIR, 'icon.ico'),
        format='ICO',
        sizes=[(s, s) for s in ico_sizes],
        append_images=ico_images[1:],
    )
    print("  Saved icon.ico")
    
    # Generate .icns (macOS) — use sips as Pillow doesn't support icns natively
    png_1024_path = os.path.join(ICONS_DIR, 'icon-1024.png')
    icns_path = os.path.join(ICONS_DIR, 'icon.icns')
    os.system(f'sips -s format icns "{png_1024_path}" --out "{icns_path}" 2>/dev/null')
    print("  Saved icon.icns")
    
    print("Done!")


if __name__ == '__main__':
    main()
