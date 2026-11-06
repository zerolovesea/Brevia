#include "UTF8Text.h"
#include <cassert>

int main() {
  @autoreleasepool {
    assert([completeUTF8Prefix("完整中文") isEqualToString:@"完整中文"]);
    assert([completeUTF8Prefix(std::string("完整中文") + "\xE4\xB8")
        isEqualToString:@"完整中文"]);
    assert([completeUTF8Prefix(std::string("回答") + "\xF0\x9F\x98")
        isEqualToString:@"回答"]);
    assert(completeUTF8Prefix("").length == 0);
  }
}
