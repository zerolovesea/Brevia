#include "EngineProtocol.h"
#include "UTF8Text.h"
#include <cassert>
#include <sstream>
int main() {
  JSON arguments = {{"huge", 1e100},
                    {"tiny", -1e100},
                    {"gpu", -1},
                    {"yes", true},
                    {"bad", "4"}};
  assert(integer(arguments, "huge", 4, 1, 32) == 32);
  assert(integer(arguments, "tiny", 4, 1, 32) == 1);
  assert(integer(arguments, "gpu", 99, -1, 999) == -1);
  assert(number(arguments, "yes", 0) == 1);
  bool rejected = false;
  try {
    number(arguments, "bad", 0);
  } catch (const std::exception &) {
    rejected = true;
  }
  assert(rejected);
  std::istringstream input("123456789\n{}\nlast");
  std::string line;
  bool oversized;
  assert(readCommandLine(input, line, oversized, 8) && oversized &&
         line == "12345678");
  assert(readCommandLine(input, line, oversized, 8) && !oversized &&
         line == "{}");
  assert(readCommandLine(input, line, oversized, 8) && !oversized &&
         line == "last");
  assert(!readCommandLine(input, line, oversized, 8));
  assert(completeUTF8Prefix("完整中文") == "完整中文");
  assert(completeUTF8Prefix(std::string("完整中文") + "\xE4\xB8") ==
         "完整中文");
  assert(completeUTF8Prefix(std::string("回答") + "\xF0\x9F\x98") == "回答");
  assert(completeUTF8Prefix("").empty());
  assert(!validUTF8("\xC0\x80"));
  assert(!validUTF8("\xED\xA0\x80"));
  assert(!validUTF8("\xF4\x90\x80\x80"));
  assert(validUTF8("\xF0\x9F\x98\x80"));
}
