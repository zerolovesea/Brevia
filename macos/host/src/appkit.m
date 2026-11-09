#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <WebKit/WebKit.h>
#import <QuartzCore/CADisplayLink.h>

typedef void (^Completion)(id value, NSString *error);

static NSData *brandedPDF(NSURL *file, NSString *svg) {
    NSData *logoData = [svg dataUsingEncoding:NSUTF8StringEncoding];
    NSImage *logo = [[NSImage alloc] initWithData:logoData];
    CGPDFDocumentRef source = CGPDFDocumentCreateWithURL((__bridge CFURLRef)file);
    if (!source || !logo) {
        if (source) CGPDFDocumentRelease(source);
        return nil;
    }
    NSMutableData *bytes = [NSMutableData data];
    CGDataConsumerRef output = CGDataConsumerCreateWithCFData((__bridge CFMutableDataRef)bytes);
    CGContextRef pdf = CGPDFContextCreate(output,NULL,NULL);
    if (!pdf) {
        CGDataConsumerRelease(output);
        CGPDFDocumentRelease(source);
        return nil;
    }
    for (size_t n=1; n<=CGPDFDocumentGetNumberOfPages(source); n++) {
        CGPDFPageRef page = CGPDFDocumentGetPage(source,n);
        CGRect area = CGPDFPageGetBoxRect(page,kCGPDFMediaBox);
        CGContextBeginPage(pdf,&area);
        CGContextDrawPDFPage(pdf,page);
        [NSGraphicsContext saveGraphicsState];
        NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithCGContext:pdf flipped:NO];
        [logo drawInRect:NSMakeRect(CGRectGetMidX(area)-35,CGRectGetMaxY(area)-26,70,22) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:0.72];
        [NSGraphicsContext restoreGraphicsState];
        CGContextEndPage(pdf);
    }
    CGPDFContextClose(pdf);
    CGContextRelease(pdf); CGDataConsumerRelease(output); CGPDFDocumentRelease(source);
    return bytes;
}

// 只给离线导出页面开启本地资源读取；打印页面不能访问应用桥。
@interface BreviaPrint : NSObject <WKNavigationDelegate>
@property(nonatomic, strong) WKWebView *view;
@property(nonatomic, copy) Completion completion;
@property(nonatomic, strong) NSURL *source;
@property(nonatomic, copy) NSString *brand;
@property(nonatomic, strong) NSURL *destination;
@property(nonatomic, strong) NSWindow *printWindow;
@end
@implementation BreviaPrint
- (void)finish:(id)value error:(NSString *)error {
    Completion reply = self.completion;
    self.completion = nil;
    self.view.navigationDelegate = nil;
    [self.printWindow orderOut:nil];
    [self.view stopLoading];
    if (reply) reply(value, error);
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))reply {
    reply([action.request.URL isEqual:self.source] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)view didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self finish:nil error:error.localizedDescription];
}
- (void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self finish:nil error:error.localizedDescription];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)view {
    [self finish:nil error:@"Print web view stopped"];
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
    NSURL *dest = [[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByAppendingPathComponent:[NSUUID.UUID.UUIDString stringByAppendingPathExtension:@"pdf"]];
    NSPrintInfo *info = [[NSPrintInfo sharedPrintInfo] copy];
    info.paperSize = NSMakeSize(595, 842);
    info.leftMargin = info.rightMargin = 28;
    info.topMargin = info.bottomMargin = 32;
    info.horizontalPagination = NSPrintingPaginationModeFit;
    info.verticalPagination = NSPrintingPaginationModeAutomatic;
    info.jobDisposition = NSPrintSaveJob;
    info.dictionary[NSPrintJobSavingURL] = dest;
    NSPrintOperation *operation = [view printOperationWithPrintInfo:info];
    operation.showsPrintPanel = NO;
    operation.showsProgressPanel = NO;
    self.destination = dest;
    operation.canSpawnSeparateThread = YES;
    [operation runOperationModalForWindow:self.printWindow delegate:self didRunSelector:@selector(didPrint:success:context:) contextInfo:NULL];
}
- (void)didPrint:(NSPrintOperation *)operation success:(BOOL)ok context:(void *)context {
    NSData *data = ok ? brandedPDF(self.destination, self.brand) : nil;
    [[NSFileManager defaultManager] removeItemAtURL:self.destination error:nil];
    NSString *encoded = [data base64EncodedStringWithOptions:0];
    dispatch_async(dispatch_get_main_queue(), ^{
        [self finish:encoded error:encoded ? nil : @"PDF export failed"];
    });
}
@end

static NSString *dialogPath(NSString *value) {
    return [value isKindOfClass:NSString.class] && value.length ? value : nil;
}

static UTType *dialogFileType(NSString *extension) {
    // “app” also names legacy single-file applications, which exclude modern app bundles.
    return [extension.lowercaseString isEqual:@"app"] ? UTTypeApplicationBundle : [UTType typeWithFilenameExtension:extension];
}

static NSString *dialogAppName(NSURL *url, NSString *locale) {
    NSBundle *bundle = [NSBundle bundleWithURL:url];
    if (!bundle) return nil;
    NSString *preferred = locale.length ? [NSBundle preferredLocalizationsFromArray:bundle.localizations forPreferences:@[locale]].firstObject : nil;
    NSURL *strings = preferred ? [bundle URLForResource:@"InfoPlist" withExtension:@"strings" subdirectory:nil localization:preferred] : nil;
    NSDictionary *localized = strings ? [NSDictionary dictionaryWithContentsOfURL:strings error:NULL] : nil;
    id name = localized[@"CFBundleDisplayName"] ?: localized[@"CFBundleName"] ?:
        [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: [bundle objectForInfoDictionaryKey:@"CFBundleName"];
    return [name isKindOfClass:NSString.class] ? name : nil;
}

static WKWebView *capsuleWebView(NSView *view) {
    if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
    for (NSView *child in view.subviews) {
        WKWebView *web = capsuleWebView(child);
        if (web) return web;
    }
    return nil;
}

// Keep the overlay until a complete display interval has elapsed after WebKit's paint.
@interface BreviaPaintHandoff : NSObject
@property(nonatomic, copy) void (^completion)(void);
@property NSInteger ticks;
- (void)frame:(CADisplayLink *)link;
@end
@implementation BreviaPaintHandoff
- (void)frame:(CADisplayLink *)link {
    if (++self.ticks < 2) return;
    self.completion();
}
@end

static void perform(NSString *method, NSDictionary *args, NSWindow *window, Completion done) {
    if ([method isEqual:@"window.setBounds"]) {
        if (!window) { done(nil, @"Window closed"); return; }
        double x = [args[@"x"] doubleValue], y = [args[@"y"] doubleValue];
        double width = [args[@"width"] doubleValue], height = [args[@"height"] doubleValue];
        if (!isfinite(x) || !isfinite(y) || !isfinite(width) || !isfinite(height) || width <= 0 || height <= 0) {
            done(nil, @"Invalid window bounds"); return;
        }
        NSRect frame = NSMakeRect(x, NSMaxY(NSScreen.screens.firstObject.frame) - y - height, width, height);
        NSRect previous = window.frame;
        WKWebView *web = capsuleWebView(window.contentView);
        __block NSWindow *cover = nil;
        __block CADisplayLink *handoff = nil;
        __block BOOL finished = NO;
        Completion finish = ^(id value, NSString *error) {
            if (finished) return;
            finished = YES;
            [handoff invalidate];
            handoff = nil;
            [cover orderOut:nil];
            cover = nil;
            done(value, error);
        };
        void (^resize)(NSImage *) = ^(NSImage *image) {
            if (finished) return;
            if (image) {
                // 独立的屏幕表面保留旧画面；胶囊窗口的所有子视图都会随原生 backing 一起缩放。
                cover = [[NSWindow alloc] initWithContentRect:previous styleMask:NSWindowStyleMaskBorderless
                    backing:NSBackingStoreBuffered defer:NO];
                cover.opaque = NO;
                cover.backgroundColor = NSColor.clearColor;
                cover.hasShadow = NO;
                cover.ignoresMouseEvents = YES;
                cover.animationBehavior = NSWindowAnimationBehaviorNone;
                cover.level = window.level;
                cover.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
                NSImageView *surface = [[NSImageView alloc] initWithFrame:cover.contentView.bounds];
                surface.image = image;
                surface.imageScaling = NSImageScaleAxesIndependently;
                cover.contentView = surface;
                [cover display];
                [cover orderWindow:NSWindowAbove relativeTo:window.windowNumber];
            }
            [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
                context.duration = 0;
                context.allowsImplicitAnimation = NO;
                window.opaque = NO;
                window.backgroundColor = NSColor.clearColor;
                window.animationBehavior = NSWindowAnimationBehaviorNone;
                [window setFrame:frame display:YES animate:NO];
                [window.contentView layoutSubtreeIfNeeded];
            } completionHandler:nil];
            if (!cover) { finish(@YES, nil); return; }
            // AppKit 的事务不等待 WebKit 提交新尺寸；保留原画面直到新一帧绘制完成。
            WKSnapshotConfiguration *updated = [WKSnapshotConfiguration new];
            updated.afterScreenUpdates = YES;
            [web takeSnapshotWithConfiguration:updated completionHandler:^(NSImage *result, NSError *error) {
                (void)result; (void)error;
                if (finished) return;
                BreviaPaintHandoff *paint = [BreviaPaintHandoff new];
                paint.completion = ^{ finish(@YES, nil); };
                handoff = [window displayLinkWithTarget:paint selector:@selector(frame:)];
                [handoff addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
            }];
        };
        if (web && window.visible && !NSEqualSizes(previous.size, frame.size)) {
            // WebContent 异常时也必须释放串行原生操作队列；迟到的快照不能再改窗口。
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
                finish(nil, @"Window redraw timed out");
            });
            [web takeSnapshotWithConfiguration:nil completionHandler:^(NSImage *image, NSError *error) {
                (void)error;
                resize(image);
            }];
        } else resize(nil);
    } else if ([method isEqual:@"dialog.open"] || [method isEqual:@"dialog.save"]) {
        BOOL save = [method isEqual:@"dialog.save"];
        NSSavePanel *panel = save ? NSSavePanel.savePanel : NSOpenPanel.openPanel;
        NSString *path = dialogPath(args[@"defaultPath"]);
        if (path) {
            BOOL directory = NO;
            [[NSFileManager defaultManager] fileExistsAtPath:path isDirectory:&directory];
            if (directory) panel.directoryURL = [NSURL fileURLWithPath:path isDirectory:YES];
            else {
                if (path.isAbsolutePath) panel.directoryURL = [NSURL fileURLWithPath:path.stringByDeletingLastPathComponent isDirectory:YES];
                if (save) panel.nameFieldStringValue = path.lastPathComponent;
            }
        }
        if (args[@"title"]) panel.title = args[@"title"];
        if (args[@"buttonLabel"]) panel.prompt = args[@"buttonLabel"];
        NSMutableArray *types = [NSMutableArray array];
        for (NSDictionary *filter in args[@"filters"]) {
            for (NSString *ext in filter[@"extensions"]) {
                UTType *type = dialogFileType(ext);
                if (type) [types addObject:type];
            }
        }
        if (types.count) panel.allowedContentTypes = types;
        if (!save) {
            NSOpenPanel *open = (NSOpenPanel *)panel;
            NSArray *props = args[@"properties"];
            open.canChooseDirectories = [props containsObject:@"openDirectory"];
            open.canChooseFiles = [props containsObject:@"openFile"] || !open.canChooseDirectories;
            open.allowsMultipleSelection = [props containsObject:@"multiSelections"];
        }
        BOOL ok = [panel runModal] == NSModalResponseOK;
        if (save) done(ok ? @{@"filePath": panel.URL.path, @"canceled": @NO} : @{@"canceled":@YES}, nil);
        else {
            NSMutableDictionary *selection = [@{@"filePaths":ok ? [((NSOpenPanel *)panel).URLs valueForKey:@"path"] : @[], @"canceled":@(!ok)} mutableCopy];
            if (ok && [types containsObject:UTTypeApplicationBundle]) {
                NSString *name = dialogAppName(panel.URL, args[@"applicationLocale"]);
                if (name.length) selection[@"localizedAppName"] = name;
            }
            done(selection,nil);
        }
    } else if ([method isEqual:@"dialog.message"]) {
        NSAlert *alert = [NSAlert new];
        alert.messageText = args[@"message"] ?: args[@"title"] ?: @"Brevia";
        alert.informativeText = args[@"detail"] ?: @"";
        for (NSString *label in args[@"buttons"] ?: @[@"OK"]) [alert addButtonWithTitle:label];
        NSUInteger index = [args[@"defaultId"] unsignedIntegerValue];
        if (index < alert.buttons.count) alert.window.defaultButtonCell = alert.buttons[index].cell;
        NSInteger cancelId = args[@"cancelId"] ? [args[@"cancelId"] integerValue] : -1;
        if (cancelId >= 0 && cancelId < (NSInteger)alert.buttons.count) alert.buttons[cancelId].keyEquivalent = @"\033";
        NSInteger button = [alert runModal] - NSAlertFirstButtonReturn;
        done(@{@"response": @(button >= 0 ? button : cancelId)}, nil);
    } else if ([method isEqual:@"shell.share"]) {
        NSMutableArray *items = [NSMutableArray arrayWithArray:args[@"texts"] ?: @[]];
        for (NSString *url in args[@"urls"]) { NSURL *item = [NSURL URLWithString:url]; if (item) [items addObject:item]; }
        for (NSString *path in args[@"filePaths"]) [items addObject:[NSURL fileURLWithPath:path]];
        if (!items.count && args[@"path"]) [items addObject:[NSURL fileURLWithPath:args[@"path"]]];
        if (!window.contentView || !items.count) { done(nil, @"No items or sharing window"); return; }
        NSSharingServicePicker *picker = [[NSSharingServicePicker alloc] initWithItems:items];
        [picker showRelativeToRect:NSMakeRect(NSMidX(window.contentView.bounds), NSMidY(window.contentView.bounds), 1, 1) ofView:window.contentView preferredEdge:NSRectEdgeMaxY];
        done(@YES, nil);
    } else if ([method isEqual:@"shell.copyText"]) {
        NSPasteboard *board = NSPasteboard.generalPasteboard;
        [board clearContents];
        done(@([board setString:args[@"text"] forType:NSPasteboardTypeString]), nil);
    } else if ([method isEqual:@"window.printPDF"]) {
        NSURL *source = [NSURL fileURLWithPath:args[@"path"]];
        BreviaPrint *job = [BreviaPrint new];
        job.source = source;
        job.brand = args[@"brand"];
        WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
        configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
        job.view = [[WKWebView alloc] initWithFrame:NSMakeRect(0,0,720,900) configuration:configuration];
        job.printWindow = [[NSWindow alloc] initWithContentRect:job.view.bounds styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        job.printWindow.contentView = job.view;
        job.view.navigationDelegate = job;
        __block BreviaPrint *activeJob = job;
        job.completion = ^(id value, NSString *error) { done(value, error); activeJob = nil; };
        [job.view loadFileURL:source allowingReadAccessToURL:source.URLByDeletingLastPathComponent];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            if (activeJob && !activeJob.destination) [activeJob finish:nil error:@"Timed out preparing PDF"];
        });
    } else {
        done(nil, @"Unknown AppKit method");
    }
}

// Rust 调用在控制线程运行，AppKit 和 WebKit 均要求主线程。
char *brevia_appkit(const char *name, const char *json, void *window) {
    @autoreleasepool {
        NSString *method = [NSString stringWithUTF8String:name];
        NSData *input = [NSData dataWithBytes:json length:strlen(json)];
        NSDictionary *args = [NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        NSWindow *parent = (__bridge NSWindow *)window;
        __block NSDictionary *result = nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            Completion finish = ^(id value, NSString *error) {
                result = error ? @{@"error":error} : @{@"result":value ?: NSNull.null};
                dispatch_semaphore_signal(semaphore);
            };
            @try { perform(method, args, parent, finish); }
            @catch (NSException *exception) { finish(nil, exception.reason); }
        });
        dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        return strdup([[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding].UTF8String);
    }
}

void brevia_free(char *response) { free(response); }

void brevia_watch_sleep(void (*notify)(void)) {
    [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceWillSleepNotification object:nil queue:nil usingBlock:^(NSNotification *note) { (void)note; notify(); }];
}

int brevia_activate_running_peer(_Bool legacyOnly) {
    @autoreleasepool {
        for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.brevia.app"]) {
            if (legacyOnly && ![NSFileManager.defaultManager fileExistsAtPath:
                [app.bundleURL URLByAppendingPathComponent:@"Contents/Resources/app.asar"].path]) continue;
            if (app.processIdentifier != NSProcessInfo.processInfo.processIdentifier && !app.terminated) {
                [app activateWithOptions:NSApplicationActivateAllWindows];
                return 1;
            }
        }
        return 0;
    }
}

void brevia_watch_minimize(void *window, void (*notify)(_Bool)) {
    NSWindow *view = (__bridge NSWindow *)window;
    dispatch_async(dispatch_get_main_queue(), ^{
        NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
        [center addObserverForName:NSWindowDidMiniaturizeNotification object:view queue:nil usingBlock:^(NSNotification *note){ (void)note; notify(1); }];
        [center addObserverForName:NSWindowDidDeminiaturizeNotification object:view queue:nil usingBlock:^(NSNotification *note){ (void)note; notify(0); }];
    });
}
