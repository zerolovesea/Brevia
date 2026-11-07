"""用原尺寸 Desktop 截图生成参考/当前/叠加/差异；合成画板只做视觉对照。"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DESIGNS = ROOT / "docs/redesign-2026-10-12"


def capture_matches_sources(capture_run):
    """旧图即使同名，也不能替代当前源码的完整运行。"""
    sources = capture_run.get("sources", {})
    return bool(capture_run.get("checksPassed") and sources) and all(
        (ROOT / name).is_file() and hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
        for name, digest in sources.items()
    )


def compare(reference, current):
    """拒绝尺寸不一致的评分，避免通过拉伸掩盖布局差异。"""
    if reference.size != current.size:
        raise ValueError(f"尺寸不一致：{reference.size} / {current.size}")
    delta = ImageChops.difference(reference, current)
    channels = delta.split()
    mask = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    mask = mask.point(lambda value: 255 if value > 24 else 0)
    fraction = mask.histogram()[255] / (reference.width * reference.height)
    heat = Image.composite(Image.new("RGB", reference.size, "#d13055"), reference, mask)
    return Image.blend(reference, current, 0.5), heat, fraction


def comparison_board(reference, current, overlay, heat):
    """并排展示原图、当前、叠加与差异，原图像素不缩放。"""
    width, height = reference.size
    board = Image.new("RGB", (width * 2, (height + 48) * 2), "#ededed")
    draw = ImageDraw.Draw(board)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
    for index, (label, picture) in enumerate(
        zip(
            ["Reference", "Desktop", "50% overlay", "Diff (>24)"],
            [reference, current, overlay, heat],
        )
    ):
        x, y = (index % 2) * width, (index // 2) * (height + 48)
        draw.text((x + 16, y + 12), label, fill="#222222", font=font)
        board.paste(picture, (x, y + 48))
    return board


def self_test():
    source = Path(__file__).resolve()
    valid_run = {
        "checksPassed": True,
        "sources": {str(source.relative_to(ROOT)): hashlib.sha256(source.read_bytes()).hexdigest()},
    }
    assert capture_matches_sources(valid_run)
    assert not capture_matches_sources({})
    assert not capture_matches_sources({**valid_run, "checksPassed": False})
    assert not capture_matches_sources(
        {"checksPassed": True, "sources": {"scripts/compare-design.py": "old"}}
    )
    white = Image.new("RGB", (16, 16), "white")
    black = Image.new("RGB", (16, 16), "black")
    assert compare(white, white)[2] == 0
    assert compare(white, black)[2] == 1
    assert comparison_board(white, black, white, black).size == (32, 128)
    try:
        compare(white, Image.new("RGB", (15, 16)))
    except ValueError:
        pass
    else:
        raise AssertionError("必须拒绝尺寸不同的截图")
    print("comparison self-check passed")


def compare_feedback(args):
    """标注修正只复拍相关表面；不冒充完整图册或抹平内容差异。"""
    output = Path(args.output) / "feedback"
    output.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 2026-10-14 标注修正对照",
        "",
        "真实 Desktop 981×613 窗口，应用 zoom=23/30，导出 DPR=30/23；文件均为1280×800。",
        "参考与截图不裁剪、不拉伸。每项保留原图、当前、50%叠加、阈值24的Diff和四格。",
        "本轮用户标注优先：更紧凑导航/列表、顶部按钮对齐、移除语言入口及纪要提示、简化手机安装说明。",
        "测试内容、日期、任务数量和本轮覆盖旧PNG的要求会产生差异；这里不提供还原率或全册通过结论。",
        "未被PNG覆盖的播放卡片、新建弹窗、减少动态效果与安装展开状态见captures/feedback；按功能/共享样式验收。",
        "",
        "| 场景 | 参考 | 对照 | 主要核对点 / 保留差异 |",
        "| --- | --- | --- | --- |",
    ]
    pairs = [
        ("library", "D53.png", "选择按钮与主操作同高、导航/列表紧凑；示例文字和日期不同"),
        (
            "sidebar-six-tasks",
            "D50.png",
            "六种真实任务组件共存；标题、动作、独立滚动与底部入口；进度为隔离fixture",
        ),
        (
            "detail-summary-sidebar-scroll",
            "D10.png",
            "长纪要侧栏：显式横线与标题边框不重复，滚动条保留16px正文留白",
        ),
        ("workspace-picker", "D50.png", "菜单不被正文穿透、选择器不裁剪；真实选项/任务数量不同"),
        ("selection-empty", "D54.png", "0项、复选框、禁用导出/删除；示例会议不同"),
        ("meeting-submenu", "D43.png", "主/二级菜单顶边、间隙和连接；实际工作区选项不同"),
        ("detail-notes", "D10.png", "标签图标与保存状态；笔记内容、标题及时间不同"),
        ("detail-transcript", "D11.png", "标签图标与阅读区域；示例段落/字幕数量不同"),
        ("detail-summary", "D23.png", "单阅读区与标题操作；实际纪要内容不同"),
        ("onboarding-ai", "D27.png", "主动性文字居中和动画；顶部配置已按用户要求撤回"),
        ("onboarding-phone", "D28.png", "保留QR/下载，删除标注说明；五步流程覆盖旧画板"),
        ("device-connection", "D47.png", "未连接/可信设备；安装入口按标注移到标题行"),
    ]
    for scene, filename, note in pairs:
        reference = Image.open(DESIGNS / filename).convert("RGB")
        current = Image.open(Path(args.feedback) / (scene + ".png")).convert("RGB")
        overlay, heat, _ = compare(reference, current)
        target = output / scene
        target.mkdir(exist_ok=True)
        shutil.copyfile(DESIGNS / filename, target / "reference.png")
        current.save(target / "current.png")
        overlay.save(target / "overlay-50.png")
        heat.save(target / "diff.png")
        comparison_board(reference, current, overlay, heat).save(
            target / "comparison-board.jpg", quality=92
        )
        lines.append(f"| {scene} | {filename} | [{scene}]({scene}/comparison-board.jpg) | {note} |")
    (output / "README.md").write_text("\n".join(lines) + "\n")
    print(f"Feedback comparisons: {len(pairs)} (原尺寸，不作相似度验收)")


def compare_mobile(args):
    """手机参考是多分镜画板；原图与完整屏幕并排，不伪造整图像素评分。"""
    manifest = json.loads((DESIGNS / "design-manifest.json").read_text())
    run_path = Path(args.mobile) / "capture-run.json"
    capture_run = json.loads(run_path.read_text()) if run_path.is_file() else {}
    if not capture_matches_sources(capture_run):
        raise ValueError("手机截图来源过期或验证未通过，请先重新复拍")
    native = Path(args.mobile).parent / "mobile-native"
    native_run = native / "capture-run.json"
    native_current = native_run.is_file() and capture_matches_sources(
        json.loads(native_run.read_text())
    )
    output = Path(args.output) / "mobile"
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for item in manifest:
        if not item["reference"].startswith("M"):
            continue
        target = output / Path(item["reference"]).stem
        target.mkdir(exist_ok=True)
        shutil.copyfile(DESIGNS / item["reference"], target / "reference.png")
        scenes = list(dict.fromkeys([item["scene"], *item.get("supplementary_scenes", [])]))
        available = [name for name in scenes if (Path(args.mobile) / (name + ".png")).is_file()]
        if not available:
            raise ValueError(f"手机画板没有截图：{item['reference']}")
        native_scenes = item.get("native_scenes", [])
        if native_scenes and not native_current:
            raise ValueError("原生iOS截图来源过期或验证未通过，请重新复拍")
        sources = [(name, Path(args.mobile) / (name + ".png")) for name in available]
        sources += [(name, native / (name + ".png")) for name in native_scenes]
        pictures = [Image.open(path).convert("RGB") for _, path in sources]
        board = Image.new("RGB", (1280, 832 + ((len(pictures) + 2) // 3) * 940), "#ededed")
        board.paste(Image.open(target / "reference.png").convert("RGB"), (0, 0))
        draw = ImageDraw.Draw(board)
        for index, ((name, path), picture) in enumerate(zip(sources, pictures)):
            shutil.copyfile(path, target / (name + ".png"))
            picture.thumbnail((400, 890))
            x, y = (index % 3) * 426 + 12, 832 + (index // 3) * 940
            draw.text((x, y), name, fill="#222222")
            board.paste(picture, (x, y + 28))
        board.save(target / "side-by-side.jpg", quality=92)
        shutil.copyfile(Path(args.mobile) / (item["scene"] + ".png"), target / "current.png")
        if args.before:
            before = Path(args.before) / (item["scene"] + ".png")
            if before.is_file():
                old = Image.open(before).convert("RGB")
                current = Image.open(target / "current.png").convert("RGB")
                overlay, heat, _ = compare(old, current)
                shutil.copyfile(before, target / "before.png")
                overlay.save(target / "before-current-overlay-50.png")
                heat.save(target / "before-current-diff.png")
        results.append(
            {
                "reference": item["reference"],
                "scenes": available,
                "nativeScenes": native_scenes,
                "status": "visual-only",
                "referenceScale": 1,
                "referenceCrop": None,
            }
        )
    (output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    lines = [
        "# 手机端最新视觉核对",
        "",
        "原始1280×800多分镜画板完整保留，Flutter屏幕只等比例缩略展示、不裁剪、不算像素还原率。",
        "当前widget截图780×1688（逻辑390×844）；真实iOS引擎截图1179×2556见../captures/mobile-native；系统状态栏/授权/锁屏未验收，批处理结束后的黑屏系统截屏已剔除。",
        "before-current叠加/Diff只比较同尺寸改前与改后，不冒称参考PNG差异；fixture补上真实Navigator栈，因此返回按钮也会变化。",
        "来源指纹、尺寸、方法与验证范围见../captures/mobile/capture-run.json；正文、人数、模型和状态使用隔离测试fixture。",
        "",
        "| 画板 | 对照与状态截图 |",
        "| --- | --- |",
    ]
    lines += [
        f"| {row['reference']} | [{len(row['scenes'])}个widget＋{len(row['nativeScenes'])}个iOS场景]({Path(row['reference']).stem}/side-by-side.jpg) |"
        for row in results
    ]
    (output / "README.md").write_text("\n".join(lines) + "\n")
    print(f"Mobile comparisons: {len(results)} composite boards, visual-only")


def run(args):
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((DESIGNS / "design-manifest.json").read_text())
    run_path = Path(args.capture) / "capture-run.json"
    capture_run = json.loads(run_path.read_text()) if run_path.is_file() else {}
    current_sources = capture_matches_sources(capture_run)
    measurements_path = Path(args.capture) / "measurements.json"
    measurements = (
        {item["name"]: item for item in json.loads(measurements_path.read_text())}
        if measurements_path.is_file()
        else {}
    )
    results = []
    for item in manifest:
        scene = item["scene"]
        row = {"reference": item["reference"], "scene": scene, "category": item["category"]}
        row["visual_audit"] = item.get("visual_audit", [])
        results.append(row)
        if not scene:
            row["status"] = "historical"
            continue
        folder = Path(args.mobile if scene.startswith("mobile-") else args.capture)
        shot = folder / (scene + ".png")
        if not shot.is_file():
            row["status"] = "not-captured"
            continue
        target = output / Path(item["reference"]).stem
        target.mkdir(exist_ok=True)
        row["fresh_capture"] = (
            current_sources
            and not scene.startswith("mobile-")
            and (scene + ".png" in capture_run.get("files", []))
        )
        (target / "audit.json").write_text(
            json.dumps(row["visual_audit"], ensure_ascii=False, indent=2) + "\n"
        )
        shutil.copyfile(DESIGNS / item["reference"], target / "reference.png")
        shutil.copyfile(shot, target / "current.png")
        row["supplementary"] = []
        for extra in item.get("supplementary_scenes", []):
            extra_folder = Path(args.mobile if extra.startswith("mobile-") else args.capture)
            extra_shot = extra_folder / (extra + ".png")
            captured = extra_shot.is_file()
            if captured:
                shutil.copyfile(extra_shot, target / (extra + ".png"))
            row["supplementary"].append(
                {
                    "scene": extra,
                    "captured": captured,
                    "fresh_capture": current_sources
                    and extra + ".png" in capture_run.get("files", []),
                }
            )
        if scene in measurements:
            row["layout"] = measurements[scene]
        reference = Image.open(target / "reference.png").convert("RGB")
        current = Image.open(shot).convert("RGB")
        # 手机内屏/系统边框与多状态画板不处于相同坐标系，不生成虚构相似度。
        composite = scene.startswith("mobile-") or item["reference"].split(".")[0] in {
            "D22-v2",
            "D24",
            "D26",
            "D33",
            "D34",
            "D39",
            "D40",
            "D46",
        }
        if composite:
            board = Image.new("RGB", (1800, 900), "#ededed")
            draw = ImageDraw.Draw(board)
            draw.text((16, 10), "REFERENCE / composite board", fill="black")
            draw.text((1160, 10), "CURRENT / actual surface (display scale only)", fill="black")
            reference.thumbnail((1100, 840))
            current.thumbnail((600, 840))
            board.paste(reference, (16, 40))
            board.paste(current, (1160, 40))
            board.save(target / "side-by-side.png")
            row.update(status="visual-only", note=item["comparison"], diff_fraction=None)
            continue
        overlay, heat, fraction = compare(reference, current)
        overlay.save(target / "overlay-50.png")
        heat.save(target / "diff.png")
        comparison_board(reference, current, overlay, heat).save(
            target / "comparison-board.jpg", quality=92
        )
        row.update(status="compared", diff_fraction=round(fraction, 4), scale=1, crop=None)
        row["nominal_regions"] = {}
        for name, box in {
            "window-bar": (0, 0, 1280, 40),
            "sidebar": (0, 40, 224, 800),
            "main": (224, 40, 1280, 800),
        }.items():
            row["nominal_regions"][name] = round(
                compare(reference.crop(box), current.crop(box))[2], 4
            )
        if args.before:
            before = Path(args.before) / (scene + ".png")
            if before.is_file():
                baseline = Image.open(before).convert("RGB")
                if baseline.size == current.size:
                    _, _, previous_fraction = compare(reference, baseline)
                    row["before_fraction"] = round(previous_fraction, 4)
    # 总览仅等比缩略展示，不参与评分。每次覆盖同名文件，不累积轮次目录。
    overview = output / "overview"
    overview.mkdir(exist_ok=True)
    desktop = [
        row
        for row in results
        if row["reference"].startswith("D") and row["status"] in {"compared", "visual-only"}
    ]
    for offset in range(0, len(desktop), 5):
        rows = desktop[offset : offset + 5]
        board = Image.new("RGB", (1280, 432 * len(rows)), "#ededed")
        draw = ImageDraw.Draw(board)
        for index, row in enumerate(rows):
            folder = output / Path(row["reference"]).stem
            for column, filename in enumerate(["reference.png", "current.png"]):
                picture = Image.open(folder / filename).convert("RGB")
                picture.thumbnail((640, 400))
                board.paste(picture, (column * 640, index * 432 + 32))
                draw.text(
                    (column * 640 + 12, index * 432 + 10),
                    row["reference"] + (" / Reference" if column == 0 else " / Desktop"),
                    fill="#222222",
                )
        board.save(overview / f"whole-desktop-{offset // 5 + 1}.jpg", quality=92)
    for previous in output.glob("D*/before-overlay-50.png"):
        previous.unlink()
    (output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    lines = [
        "# 运行对照",
        "",
        "`overview` 为全册并排，`comparison-board.jpg` 为原图/当前/叠加/Diff 四格。",
        "图片在同名子目录中。desktop 主参考与渲染文件均为 1280×800，无裁剪或缩放；实际 CSS 尺寸与导出 DPR 见 captures/desktop/measurements.json。",
        "阈值 24 的差异率包括模拟窗口、示例内容和字体抗锯齿，仅为定位线索，不是验收分数。",
        "合成画板/手机只输出并排图；展示缩放等比、不评分、不伪造覆盖其他分镜。",
        "本轮捕获时间、源码SHA256与文件清单见 captures/desktop/capture-run.json；手机截图未复拍。",
        "每页 audit.json 从设计 manifest 生成，记录主要差异、根因与处理结果。",
        "源码指纹与捕获检查状态："
        + ("匹配，通过。" if current_sources else "不匹配或缺失，不能作为当前源码完成证据。"),
        "",
        "| 原图 | 场景 | 证据 | 本轮复拍 | 原尺寸差异率 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in results:
        name = Path(row["reference"]).stem
        link = (
            f"[{row['status']}]({name}/current.png)"
            if row["status"] in {"compared", "visual-only"}
            else row["status"]
        )
        lines.append(
            f"| {row['reference']} | {row['scene'] or '历史'} | {link} | "
            f"{'是' if row.get('fresh_capture') else '否'} | {row.get('diff_fraction', '—')} |"
        )
    (output / "README.md").write_text("\n".join(lines) + "\n")
    print(
        f"{len(results)} references: "
        + ", ".join(
            f"{status}={sum(row['status'] == status for row in results)}"
            for status in ["compared", "visual-only", "not-captured", "historical"]
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--capture", default="output/playwright/layout-style-comparison/captures/desktop"
    )
    parser.add_argument(
        "--mobile", default="output/playwright/layout-style-comparison/captures/mobile"
    )
    parser.add_argument("--before")
    parser.add_argument(
        "--mobile-only", action="store_true", help="仅更新手机多分镜对照，保留桌面结果"
    )
    parser.add_argument("--feedback", help="只比较标注反馈的独立Desktop截图目录")
    parser.add_argument("--output", default="output/playwright/layout-style-comparison")
    parser.add_argument("--self-test", action="store_true")
    options = parser.parse_args()
    if options.self_test:
        self_test()
    elif options.mobile_only:
        compare_mobile(options)
    elif options.feedback:
        compare_feedback(options)
    else:
        run(options)
