import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'design_icons.dart';

/// 公共节奏只控制视觉，不延迟录音、保存、网络或系统导航。
abstract final class BreviaMotion {
  static const press = Duration(milliseconds: 80);
  static const feedback = Duration(milliseconds: 120);
  static const state = Duration(milliseconds: 180);
  static const surface = Duration(milliseconds: 220);
  static const spatial = Duration(milliseconds: 280);
  static const exit = Duration(milliseconds: 140);
  static const out = Cubic(.16, 1, .3, 1);
  static const into = Cubic(.4, 0, 1, 1);
  static const inOut = Cubic(.4, 0, .2, 1);

  static Duration duration(BuildContext context, Duration value) =>
      (MediaQuery.maybeDisableAnimationsOf(context) ??
          WidgetsBinding
              .instance
              .platformDispatcher
              .accessibilityFeatures
              .disableAnimations)
      ? Duration.zero
      : value;

  static AnimationStyle sheet(BuildContext context) => AnimationStyle(
    duration: duration(context, spatial),
    reverseDuration: duration(context, state),
  );
}

/// 只让当前状态参与布局与读屏，旧状态不能在淡出期间继续响应。
class BreviaStateChange extends StatelessWidget {
  final Widget child;
  const BreviaStateChange({super.key, required this.child});

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
    duration: BreviaMotion.duration(context, BreviaMotion.feedback),
    reverseDuration: BreviaMotion.duration(context, BreviaMotion.press),
    switchInCurve: BreviaMotion.out,
    switchOutCurve: BreviaMotion.into,
    transitionBuilder: (child, animation) => FadeTransition(
      opacity: animation,
      child: ScaleTransition(
        scale: Tween<double>(begin: .9, end: 1).animate(animation),
        child: child,
      ),
    ),
    layoutBuilder: (current, previous) => current ?? const SizedBox.shrink(),
    child: child,
  );
}

// 保留正在退出的正文，避免新正文首帧透明时露出空背景；旧层不可操作或读屏。
Widget breviaPageLayout(Widget? current, List<Widget> previous) => Stack(
  fit: StackFit.expand,
  children: [
    for (final child in [...previous, ?current])
      KeyedSubtree(
        key: child.key,
        child: TickerMode(
          enabled: identical(child, current),
          child: IgnorePointer(
            ignoring: !identical(child, current),
            child: ExcludeFocus(
              excluding: !identical(child, current),
              child: ExcludeSemantics(
                excluding: !identical(child, current),
                child: child,
              ),
            ),
          ),
        ),
      ),
  ],
);

// 桌面与手机使用同一语义色板，控件大小遵循原生触控约定。
ThemeData breviaTheme(Brightness brightness, {String? fontFamily}) {
  final dark = brightness == Brightness.dark;
  fontFamily ??= defaultTargetPlatform == TargetPlatform.iOS
      ? '.SF Pro Text'
      : 'Roboto';
  final ink = dark ? Color(0xfff0f0f0) : Color(0xff171717);
  final canvas = dark ? Color(0xff101010) : Color(0xfff4f4f4);
  final muted = dark ? Color(0xffacacac) : Color(0xff696969);
  final line = dark ? Color(0xff404040) : Color(0xffd4d4d4);
  final sheet = dark ? Color(0xff171717) : Colors.white;
  final scheme = ColorScheme.fromSeed(seedColor: ink, brightness: brightness)
      .copyWith(
        primary: ink,
        onPrimary: canvas,
        primaryContainer: dark ? Color(0xff303030) : Color(0xffeeeeee),
        onPrimaryContainer: ink,
        secondary: ink,
        onSecondary: canvas,
        secondaryContainer: dark ? Color(0xff303030) : Color(0xffeeeeee),
        onSecondaryContainer: ink,
        tertiary: ink,
        onTertiary: canvas,
        tertiaryContainer: dark ? Color(0xff2a2a2a) : Color(0xfffafafa),
        onTertiaryContainer: ink,
        inverseSurface: ink,
        onInverseSurface: canvas,
        surface: canvas,
        surfaceContainerLowest: dark ? Color(0xff151515) : Color(0xffffffff),
        surfaceContainerLow: dark ? Color(0xff171717) : Color(0xffffffff),
        surfaceContainer: dark ? Color(0xff171717) : Color(0xfffafafa),
        surfaceContainerHigh: dark ? Color(0xff2a2a2a) : Color(0xfffafafa),
        surfaceContainerHighest: dark ? Color(0xff2a2a2a) : Color(0xffeeeeee),
        onSurface: ink,
        onSurfaceVariant: muted,
        outline: line,
        outlineVariant: dark
            ? const Color(0xff2b2b2b)
            : const Color(0xffe5e5e5),
        surfaceTint: Colors.transparent,
        error: dark ? Color(0xffed9494) : Color(0xffa83b3b),
      );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: canvas,
    fontFamily: fontFamily,
  );
  return base.copyWith(
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: BreviaPageTransitionsBuilder(),
        TargetPlatform.iOS: BreviaPageTransitionsBuilder(),
        TargetPlatform.macOS: BreviaPageTransitionsBuilder(),
      },
    ),
    iconTheme: IconThemeData(color: ink, size: 24),
    splashFactory: NoSplash.splashFactory,
    actionIconTheme: ActionIconThemeData(
      backButtonIconBuilder: (_) => const BreviaIcon(Icons.chevron_left),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: ink,
      linearTrackColor: dark ? Color(0xff404040) : Color(0xffe5e5e9),
      linearMinHeight: 6,
      borderRadius: BorderRadius.circular(3),
      trackGap: 0,
      stopIndicatorRadius: 0,
    ),
    sliderTheme: SliderThemeData(
      trackHeight: 3,
      activeTrackColor: ink,
      inactiveTrackColor: line,
      thumbColor: ink,
      thumbShape: const RoundSliderThumbShape(
        enabledThumbRadius: 3,
        disabledThumbRadius: 3,
      ),
      overlayShape: SliderComponentShape.noOverlay,
      trackShape: const RoundedRectSliderTrackShape(),
      padding: EdgeInsets.zero,
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: Size(48, 48)).copyWith(
        foregroundBuilder: breviaPressFeedback,
        animationDuration: BreviaMotion.feedback,
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: sheet,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        animationDuration: BreviaMotion.state,
        side: WidgetStatePropertyAll(BorderSide(color: line)),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        ),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: canvas,
      foregroundColor: ink,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: fontFamily,
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: ink,
      ),
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    textTheme: base.textTheme
        .copyWith(
          headlineLarge: TextStyle(
            fontSize: 28,
            letterSpacing: -1.1,
            height: 1.18,
            fontWeight: FontWeight.w600,
            color: ink,
          ),
          headlineSmall: TextStyle(
            fontSize: 24,
            letterSpacing: -.5,
            height: 1.25,
            fontWeight: FontWeight.w600,
            color: ink,
          ),
          titleLarge: TextStyle(
            fontSize: 20,
            height: 1.4,
            fontWeight: FontWeight.w600,
            color: ink,
          ),
          bodySmall: TextStyle(
            fontSize: 13,
            height: 1.4,
            fontWeight: FontWeight.w400,
            color: muted,
          ),
          bodyLarge: TextStyle(
            fontSize: 16,
            height: 1.65,
            fontWeight: FontWeight.w400,
            color: ink,
          ),
          bodyMedium: TextStyle(
            fontSize: 16,
            height: 1.4,
            fontWeight: FontWeight.w400,
            color: ink,
          ),
        )
        .apply(fontFamily: fontFamily),
    dividerTheme: DividerThemeData(
      color: dark ? Color(0xff404040) : Color(0xffd4d4d4),
      thickness: .5,
      space: 32,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surfaceContainerLow,
      contentPadding: EdgeInsets.all(16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(24),
        borderSide: BorderSide(color: line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(24),
        borderSide: BorderSide(color: line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(24),
        borderSide: BorderSide(color: scheme.primary, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style:
          FilledButton.styleFrom(
            minimumSize: Size(48, 48),
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            textStyle: TextStyle(
              fontFamily: fontFamily,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(24),
            ),
          ).copyWith(
            foregroundBuilder: breviaPressFeedback,
            animationDuration: BreviaMotion.feedback,
          ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style:
          OutlinedButton.styleFrom(
            minimumSize: Size(48, 48),
            foregroundColor: ink,
            side: BorderSide(color: line),
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            textStyle: TextStyle(
              fontFamily: fontFamily,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(24),
            ),
          ).copyWith(
            foregroundBuilder: breviaPressFeedback,
            animationDuration: BreviaMotion.feedback,
          ),
    ),
    textButtonTheme: TextButtonThemeData(
      style:
          TextButton.styleFrom(
            minimumSize: Size(48, 48),
            foregroundColor: ink,
            textStyle: TextStyle(
              fontFamily: fontFamily,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(24),
            ),
          ).copyWith(
            foregroundBuilder: breviaPressFeedback,
            animationDuration: BreviaMotion.feedback,
          ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: sheet,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: ink,
      contentPadding: EdgeInsets.zero,
      minVerticalPadding: 10,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      titleTextStyle: TextStyle(
        fontFamily: fontFamily,
        fontSize: 15,
        fontWeight: FontWeight.w500,
        height: 1.35,
        color: ink,
      ),
      subtitleTextStyle: TextStyle(
        fontFamily: fontFamily,
        fontSize: 14,
        height: 1.4,
        color: muted,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: canvas,
      height: 64,
      elevation: 0,
      indicatorColor: scheme.onSurface,
      indicatorShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          size: 24,
          color: states.contains(WidgetState.selected) ? canvas : muted,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w600
              : FontWeight.w400,
          color: states.contains(WidgetState.selected) ? ink : muted,
        ),
      ),
    ),
  );
}

// 只缩放按钮内容，触控与读屏区域始终保持原尺寸。
Widget breviaPressFeedback(
  BuildContext context,
  Set<WidgetState> states,
  Widget? child,
) => AnimatedScale(
  scale:
      !MediaQuery.disableAnimationsOf(context) &&
          states.contains(WidgetState.pressed)
      ? .96
      : 1,
  duration: BreviaMotion.duration(
    context,
    states.contains(WidgetState.pressed)
        ? BreviaMotion.press
        : BreviaMotion.state,
  ),
  curve: states.contains(WidgetState.pressed)
      ? BreviaMotion.out
      : Curves.easeOutBack,
  child: child,
);

class BreviaPageTransitionsBuilder extends PageTransitionsBuilder {
  const BreviaPageTransitionsBuilder();

  @override
  Duration get transitionDuration => BreviaMotion.surface;

  @override
  Duration get reverseTransitionDuration => BreviaMotion.state;

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    if (reduced && !ios) {
      return FadeTransition(opacity: animation, child: child);
    }
    final builder = ios
        ? const CupertinoPageTransitionsBuilder()
        : const FadeForwardsPageTransitionsBuilder();
    // 减少动态效果时固定空间位移，保留系统的侧滑返回手势。
    final transition = builder.buildTransitions(
      route,
      context,
      reduced ? kAlwaysCompleteAnimation : animation,
      reduced ? kAlwaysDismissedAnimation : secondaryAnimation,
      child,
    );
    return reduced
        ? FadeTransition(opacity: animation, child: transition)
        : transition;
  }
}

Widget breviaBrand(BuildContext context, {double size = 32}) =>
    SvgPicture.asset(
      'assets/brand.svg',
      width: size * 3.75,
      height: size,
      semanticsLabel: 'Brevia',
      colorFilter: Theme.of(context).brightness == Brightness.dark
          ? const ColorFilter.matrix([
              -1,
              0,
              0,
              0,
              255,
              0,
              -1,
              0,
              0,
              255,
              0,
              0,
              -1,
              0,
              255,
              0,
              0,
              0,
              1,
              0,
            ])
          : null,
    );

Widget breviaLogo({double size = 32}) => Image.asset(
  'assets/brevia-logo.png',
  width: size,
  height: size,
  fit: BoxFit.contain,
  semanticLabel: 'Brevia',
);

class BreviaPanel extends StatelessWidget {
  const BreviaPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = 24,
  });
  final Widget child;
  final double radius;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerLow,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(padding: padding, child: child),
    );
  }
}

class BreviaGlyph extends StatelessWidget {
  const BreviaGlyph(this.icon, {super.key});
  final IconData icon;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(10),
      color: Theme.of(context).colorScheme.surfaceContainer,
    ),
    child: Padding(
      padding: const EdgeInsets.all(10),
      child: BreviaIcon(icon, size: 20),
    ),
  );
}

/// Intrinsic widths keep long translations and large text horizontally accessible.
class MeetingDestinations extends StatelessWidget {
  const MeetingDestinations({
    super.key,
    this.compact = false,
    required this.entries,
    required this.selected,
    required this.onSelect,
  });
  final List<(int, String)> entries;
  final int selected;
  final bool compact;
  final ValueChanged<int> onSelect;
  @override
  Widget build(BuildContext context) {
    const icons = [
      Icons.subject,
      Icons.edit_note,
      Icons.bookmark_border,
      Icons.article_outlined,
      Icons.account_tree_outlined,
    ];
    final colors = Theme.of(context).colorScheme;
    return BreviaPanel(
      radius: 14,
      padding: const EdgeInsets.all(5),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final (value, label) in entries)
              Semantics(
                selected: value == selected,
                child: TextButton(
                  onPressed: () => onSelect(value),
                  style: TextButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    minimumSize: const Size(48, 44),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    backgroundColor: value == selected
                        ? colors.inverseSurface
                        : null,
                    foregroundColor: value == selected
                        ? colors.onInverseSurface
                        : colors.onSurfaceVariant,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedSize(
                        duration: BreviaMotion.duration(
                          context,
                          BreviaMotion.feedback,
                        ),
                        child: compact
                            ? const SizedBox.shrink()
                            : Icon(icons[value], size: 18),
                      ),
                      Text(label, style: const TextStyle(fontSize: 12)),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class BreviaTabs extends StatelessWidget {
  const BreviaTabs({
    super.key,
    required this.entries,
    required this.selected,
    required this.onSelect,
  });
  final List<(int, String)> entries;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final (value, label) in entries)
              Semantics(
                selected: selected == value,
                child: TextButton(
                  style: TextButton.styleFrom(
                    minimumSize: const Size(48, 44),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 2,
                      vertical: 4,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(24),
                    ),
                    animationDuration: BreviaMotion.duration(
                      context,
                      BreviaMotion.feedback,
                    ),
                    foregroundColor: selected == value
                        ? scheme.onInverseSurface
                        : scheme.onSurfaceVariant,
                    textStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
                      fontSize: 14,
                      fontWeight: selected == value
                          ? FontWeight.w600
                          : FontWeight.w500,
                    ),
                  ),
                  onPressed: () => onSelect(value),
                  child: AnimatedContainer(
                    duration: BreviaMotion.duration(
                      context,
                      BreviaMotion.feedback,
                    ),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: selected == value
                          ? scheme.inverseSurface
                          : scheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(100),
                    ),
                    child: Tooltip(message: label, child: Text(label)),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 入场点阵只播放一轮，随后静止，不常驻消耗录音电量。
class BreviaAmbientSurface extends StatelessWidget {
  const BreviaAmbientSurface({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: 1),
    duration: BreviaMotion.duration(
      context,
      const Duration(milliseconds: 2600),
    ),
    curve: Curves.easeOutCubic,
    child: child,
    builder: (context, phase, child) => CustomPaint(
      painter: _AmbientDots(Theme.of(context).colorScheme.onSurface, phase),
      child: child,
    ),
  );
}

class _AmbientDots extends CustomPainter {
  const _AmbientDots(this.ink, this.phase);
  final Color ink;
  final double phase;
  @override
  void paint(Canvas canvas, Size size) {
    // 点阵在右侧留白区渐隐，正文始终保持纯净背景。
    final paint = Paint();
    for (var x = size.width * .55; x < size.width; x += 9) {
      for (var y = 8.0; y < size.height; y += 9) {
        final distance = ((x / size.width) - phase).abs();
        final strength = (1 - distance * 3).clamp(0.0, 1.0);
        paint.color = ink.withValues(alpha: .025 + strength * .065);
        canvas.drawCircle(Offset(x, y), .6 + strength * .45, paint);
      }
    }
  }

  @override
  bool shouldRepaint(_AmbientDots old) => old.phase != phase || old.ink != ink;
}
