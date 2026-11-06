#pragma once
#import <Foundation/Foundation.h>
#include <algorithm>
#include <string>

// 生成上限可能落在 UTF-8 字符中间；只去掉末尾残片，保留此前完整文本。
static NSString *completeUTF8Prefix(const std::string &value) {
  for (size_t missing = 0; missing <= std::min<size_t>(3, value.size());
       ++missing) {
    NSString *result = [[NSString alloc] initWithBytes:value.data()
                                                length:value.size() - missing
                                              encoding:NSUTF8StringEncoding];
    if (result)
      return result;
  }
  return @"";
}
