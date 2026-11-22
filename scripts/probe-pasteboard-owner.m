#import <AppKit/AppKit.h>
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc > 1) {
      NSPasteboard *p = [NSPasteboard pasteboardWithName:[NSString stringWithUTF8String:argv[1]]];
      if (!p) { fprintf(stderr, "named pasteboard unavailable\n"); return 3; }
      [p declareTypes:@[NSPasteboardTypeString] owner:nil];
      return [p setString:@"synthetic child" forType:NSPasteboardTypeString] ? 0 : 2;
    }
    NSPasteboard *p = [NSPasteboard pasteboardWithUniqueName];
    if (!p || !p.name) { fprintf(stderr, "named pasteboard unavailable\n"); return 3; }
    [p declareTypes:@[NSPasteboardTypeString] owner:nil];
    BOOL before = [p setString:@"synthetic initial" forType:NSPasteboardTypeString];
    NSTask *child = [[NSTask alloc] init];
    child.executableURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[0]]];
    child.arguments = @[p.name];
    NSError *error = nil;
    if (![child launchAndReturnError:&error]) { fprintf(stderr, "child launch failed\n"); return 3; }
    [child waitUntilExit];
    BOOL after = [p setString:@"synthetic stale owner" forType:NSPasteboardTypeString];
    printf("initial_write=%s child_exit=%d stale_write=%s\n", before ? "success" : "failure", child.terminationStatus, after ? "success" : "failure");
    [p releaseGlobally];
    return (before && child.terminationStatus == 0 && !after) ? 0 : 4;
  }
}
