"""复用源 SVG 的几何及动画最终帧检查（不修改品牌源文件）。"""

from pathlib import Path
from io import BytesIO
import json
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
repo = root.parents[1]
out = root / 'outputs'
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 900, 'height': 600}, device_scale_factor=2)
    frames = []
    for query in ['static=1', 't=1500']:
        page.goto(root.joinpath('logo_motion.html').as_uri() + '?' + query)
        page.wait_for_function('window.__p2mReady === true')
        frames.append(Image.open(BytesIO(page.locator('#logo-root').screenshot())).convert('RGB'))
    delta = ImageChops.difference(*frames)
    assert delta.getbbox() is None, '最终帧偏离静态品牌图'
    frames[0].save(out / 'html_render.png')
    page.set_viewport_size({'width': 505, 'height': 160})
    for source, name in [
        (repo / 'frontend/assets/brevia-logo.svg', 'source.png'),
        (root / 'logo.svg', 'final_render.png'),
    ]:
        page.goto(source.as_uri())
        page.screenshot(path=str(out / name))
    a, b = [Image.open(out / n).convert('RGB') for n in ['source.png', 'final_render.png']]
    assert ImageChops.difference(a, b).getbbox() is None
    overlay = Image.blend(a, Image.new('RGB', a.size, '#00cfff'), 0.25)
    (out / 'fit_iterations').mkdir(exist_ok=True)
    overlay.save(out / 'fit_iterations/01_reused_vector_overlay.png')
    strip = Image.new('RGB', (a.width * 3, a.height), 'white')
    for i, img in enumerate([a, overlay, b]):
        strip.paste(img, (i * a.width, 0))
    strip.save(out / 'overlay_progress_strip.png')
    b.crop((0, 0, 320, 320)).resize((1280, 1280)).save(out / 'smoothness_zoom.png')
    (out / 'geometry_metrics.json').write_text(
        json.dumps(
            {
                'iou': 1.0,
                'src_only_px': 0,
                'render_only_px': 0,
                'same_pipeline_final_diff': 0,
                'reason': '原样复用既有 SVG 几何，非重新描摹',
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    browser.close()
