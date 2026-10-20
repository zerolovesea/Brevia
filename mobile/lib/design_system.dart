import 'dart:io';
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
      opacity: Tween<double>(begin: .55, end: 1).animate(animation),
      child: child,
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
ThemeData breviaTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final fontFamily = Platform.isIOS ? '.SF Pro Text' : 'Roboto';
  final ink = dark ? Color(0xfff2f2f2) : Color(0xff222222);
  final canvas = dark ? Color(0xff191919) : Color(0xffffffff);
  final muted = dark ? Color(0xffb0b0b0) : Color(0xff666666);
  final line = dark ? Color(0xff4a4a4a) : Color(0xffd6d6d6);
  final sheet = dark ? Color(0xff242424) : Colors.white;
  final scheme = ColorScheme.fromSeed(seedColor: ink, brightness: brightness)
      .copyWith(
        primary: ink,
        onPrimary: canvas,
        primaryContainer: dark ? Color(0xff303030) : Color(0xfff2f2f2),
        onPrimaryContainer: ink,
        secondary: ink,
        onSecondary: canvas,
        secondaryContainer: dark ? Color(0xff303030) : Color(0xfff2f2f2),
        onSecondaryContainer: ink,
        tertiary: ink,
        onTertiary: canvas,
        tertiaryContainer: dark ? Color(0xff303030) : Color(0xfff2f2f2),
        onTertiaryContainer: ink,
        inverseSurface: ink,
        onInverseSurface: canvas,
        surface: canvas,
        surfaceContainerLowest: dark ? Color(0xff151515) : Color(0xfffafafa),
        surfaceContainerLow: dark ? Color(0xff242424) : Color(0xfffafafa),
        surfaceContainer: dark ? Color(0xff242424) : Color(0xfff2f2f2),
        surfaceContainerHigh: dark ? Color(0xff303030) : Color(0xfff2f2f2),
        surfaceContainerHighest: dark ? Color(0xff303030) : Color(0xffeaeaea),
        onSurface: ink,
        onSurfaceVariant: muted,
        outline: line,
        outlineVariant: line,
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
      linearTrackColor: dark ? Color(0xff4a4a4a) : Color(0xffe5e5e9),
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
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        animationDuration: BreviaMotion.state,
        side: WidgetStatePropertyAll(BorderSide(color: line)),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: canvas,
      foregroundColor: ink,
      centerTitle: true,
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
            fontSize: 32,
            height: 1.25,
            fontWeight: FontWeight.w600,
            color: ink,
          ),
          headlineSmall: TextStyle(
            fontSize: 24,
            height: 1.4,
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
      color: dark ? Color(0xff4a4a4a) : Color(0xffd6d6d6),
      thickness: .5,
      space: 32,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: canvas,
      contentPadding: EdgeInsets.all(16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style:
          FilledButton.styleFrom(
            minimumSize: Size(48, 52),
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            textStyle: TextStyle(
              fontFamily: fontFamily,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          ).copyWith(
            foregroundBuilder: breviaPressFeedback,
            animationDuration: BreviaMotion.feedback,
          ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style:
          OutlinedButton.styleFrom(
            minimumSize: Size(48, 52),
            foregroundColor: ink,
            side: BorderSide(color: line),
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            textStyle: TextStyle(
              fontFamily: fontFamily,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
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
              borderRadius: BorderRadius.circular(8),
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
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: ink,
      contentPadding: EdgeInsets.zero,
      minVerticalPadding: 8,
      titleTextStyle: TextStyle(
        fontFamily: fontFamily,
        fontSize: 17,
        height: 1.3,
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
      indicatorColor: Colors.transparent,
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          size: 24,
          color: states.contains(WidgetState.selected) ? ink : muted,
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

Widget breviaBrand(BuildContext context, {double size = 32}) => Image.asset(
  Theme.of(context).brightness == Brightness.dark
      ? 'assets/brevia-lockup-dark.png'
      : 'assets/brevia-lockup.png',
  width: size * 505 / 160,
  height: size,
  fit: BoxFit.contain,
  semanticLabel: 'Brevia',
);

Widget breviaLogo({double size = 32}) => Image.asset(
  'assets/brevia-logo.png',
  width: size,
  height: size,
  fit: BoxFit.contain,
  semanticLabel: 'Brevia',
);
