#include <iostream>
#include <string>
int main() {
  std::cout << "{\"type\":\"ready\",\"micFellBack\":false}\n" << std::flush;
  std::string command;
  while (std::getline(std::cin,command)) {
    if (!command.empty() && command.back()=='\r') command.pop_back();
    if(command=="stop") {
      // 100 ms PCM16 固定输入，验证 stop 的最后一帧先落盘再确认。
      std::string pcm;
      for(int i=0;i<1066;i++) pcm+="AQEB";
      pcm+="AQE=";
      std::cout << "{\"type\":\"audio\",\"track\":\"mic\",\"sample_rate\":16000,\"start_ms\":0,\"pcm\":\"" << pcm << "\"}\n";
    }
    std::cout << "{\"type\":\"ack\",\"command\":\"" << command << "\"}\n" << std::flush;
    if(command=="stop") break;
  }
}
