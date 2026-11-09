#import "src/appkit.m"
#include <assert.h>

@interface CapsuleTestWebView : WKWebView
@property NSInteger snapshotsBeforeStall;
@property BOOL checkedUpdatedSnapshot;
@property BOOL pillAtBottom;
@property BOOL dark;
@property(copy) void (^delayedSnapshot)(NSImage *, NSError *);
@end
@implementation CapsuleTestWebView
- (void)takeSnapshotWithConfiguration:(WKSnapshotConfiguration *)configuration completionHandler:(void (^)(NSImage *, NSError *))completion {
    if (self.snapshotsBeforeStall == 0) { self.delayedSnapshot = completion; return; }
    if (self.snapshotsBeforeStall > 0) self.snapshotsBeforeStall--;
    [super takeSnapshotWithConfiguration:configuration completionHandler:^(NSImage *image, NSError *error) {
        if (configuration.afterScreenUpdates) {
            // 在被独立表面覆盖时，WebKit 仍保持可见并绘制新尺寸。
            assert(image && !error);
            NSBitmapImageRep *pixels = [NSBitmapImageRep imageRepWithData:image.TIFFRepresentation];
            NSInteger y = 40 * pixels.pixelsHigh / self.bounds.size.height;
            if (self.pillAtBottom) y = pixels.pixelsHigh - y;
            NSColor *color = [[pixels colorAtX:40 * pixels.pixelsWide / self.bounds.size.width y:y]
                colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
            assert(color.alphaComponent > 0.99);
            assert(self.dark ? color.redComponent < 0.15 : color.redComponent > 0.95);
            assert([pixels colorAtX:0 y:0].alphaComponent == 0);
            self.checkedUpdatedSnapshot = YES;
        }
        completion(image,error);
    }];
}
@end

static void waitUntil(BOOL (^finished)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
    while (!finished() && deadline.timeIntervalSinceNow > 0)
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    assert(finished());
}

int main(void) {
    @autoreleasepool {
        assert([UTTypeApplicationBundle conformsToType:dialogFileType(@"app")]);
        assert([dialogFileType(@"png") isEqual:UTTypePNG]);
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(100,100,344,80)
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        CapsuleTestWebView *web = [[CapsuleTestWebView alloc] initWithFrame:window.contentView.bounds];
        web.snapshotsBeforeStall = -1;
        [web setValue:@NO forKey:@"drawsBackground"];
        web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [window.contentView addSubview:web];
        [window orderFront:nil];
        for (NSNumber *dark in @[@NO,@YES]) {
            web.dark = dark.boolValue;
            for (NSNumber *above in @[@NO,@YES]) {
                web.checkedUpdatedSnapshot = NO;
                web.pillAtBottom = above.boolValue;
                NSString *html = [NSString stringWithFormat:
                    @"<style>html,body{margin:0;background:transparent}div{position:absolute;left:12px;%@:12px;width:320px;height:56px;border-radius:28px;background:%@}</style><div></div>",
                    above.boolValue ? @"bottom" : @"top", dark.boolValue ? @"#171717" : @"#ffffff"];
                [web loadHTMLString:html baseURL:nil];
                __block BOOL loaded = NO;
                waitUntil(^BOOL { return !web.loading; });
                [web evaluateJavaScript:@"document.querySelector('div') !== null" completionHandler:^(id result, NSError *error) {
                    assert(!error && [result boolValue]);
                    loaded = YES;
                }];
                waitUntil(^BOOL { return loaded; });
                for (NSNumber *expanded in @[@YES,@NO,@YES,@NO]) {
                    NSRect previous = window.frame;
                    double height = expanded.boolValue ? 470 : 80;
                    double y = above.boolValue ? previous.origin.y : NSMaxY(previous) - height;
                    NSRect target = NSMakeRect(100,y,expanded.boolValue ? 464 : 344,height);
                    __block BOOL covered = NO;
                    id observer = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidResizeNotification
                        object:window queue:nil usingBlock:^(NSNotification *note) {
                            (void)note;
                            for (NSWindow *surface in NSApp.orderedWindows) {
                                if (surface == window) break;
                                if (!surface.visible || ![surface.contentView isKindOfClass:NSImageView.class]) continue;
                                assert(surface.ignoresMouseEvents && NSEqualRects(surface.frame, previous));
                                assert(web.alphaValue == 1 && !surface.opaque);
                                NSImageView *cover = (NSImageView *)surface.contentView;
                                NSBitmapImageRep *pixels = [NSBitmapImageRep imageRepWithData:cover.image.TIFFRepresentation];
                                NSInteger pixelY = above.boolValue ? pixels.pixelsHigh - 40 * pixels.pixelsHigh / previous.size.height
                                    : 40 * pixels.pixelsHigh / previous.size.height;
                                NSColor *color = [[pixels colorAtX:40 * pixels.pixelsWide / previous.size.width y:pixelY]
                                    colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
                                assert(color.alphaComponent > 0.99);
                                assert(dark.boolValue ? color.redComponent < 0.15 : color.redComponent > 0.95);
                                covered = YES;
                            }
                        }];
                    __block BOOL finished = NO;
                    perform(@"window.setBounds", @{@"x":@100,@"y":@(NSMaxY(NSScreen.screens.firstObject.frame)-NSMaxY(target)),
                        @"width":@(target.size.width),@"height":@(height)}, window, ^(id result, NSString *error) {
                            assert(!error && [result boolValue]);
                            assert(covered);
                            assert(NSEqualRects(window.frame,target));
                            assert(window.contentView.subviews.count == 1);
                            assert(web.alphaValue == 1);
                            finished = YES;
                        });
                    waitUntil(^BOOL { return finished; });
                    [NSNotificationCenter.defaultCenter removeObserver:observer];
                }
                assert(web.checkedUpdatedSnapshot);
            }
        }
        for (NSNumber *count in @[@0,@1]) {
            web.snapshotsBeforeStall = count.integerValue;
            __block BOOL finished = NO;
            perform(@"window.setBounds", @{@"x":@100,@"y":@100,@"width":@464,@"height":@470}, window,
                ^(id result, NSString *error) {
                    (void)result;
                    assert(!finished);
                    assert([error isEqual:@"Window redraw timed out"]);
                    assert(web.alphaValue == 1 && window.contentView.subviews.count == 1);
                    finished = YES;
                });
            waitUntil(^BOOL { return finished; });
            NSRect frame = window.frame;
            web.delayedSnapshot(nil, [NSError errorWithDomain:@"test" code:1 userInfo:nil]);
            web.delayedSnapshot = nil;
            assert(NSEqualRects(frame,window.frame));
            assert(web.alphaValue == 1 && window.contentView.subviews.count == 1);
        }
        [window orderOut:nil];
        puts("Native capsule: light/dark painted resize, transparent margins, anchor and snapshot timeout cleanup passed.");
    }
}
