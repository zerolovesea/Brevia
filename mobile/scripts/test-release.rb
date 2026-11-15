# Run without credentials or network: ruby mobile/scripts/test-release.rb
# Exercise the release entry points without invoking fastlane's external actions.
module UI
  def self.user_error!(message)
    raise ArgumentError, message
  end
end

lanes = {}
sent = []
context = Object.new
context.define_singleton_method(:lane) { |name, &block| lanes[name] = block }
context.define_singleton_method(:app_store_connect_api_key) { |**_| :test_key }
context.define_singleton_method(:upload_to_testflight) { |**options| sent << options }
context.define_singleton_method(:upload_to_app_store) { |**options| sent << options }
path = File.expand_path('../fastlane/Fastfile', __dir__)
context.instance_eval(File.read(path), path)
%w[ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8_BASE64].each { |key| ENV[key] = 'test' }
ENV['BUILD_NUMBER'] = '123'
ENV['GITHUB_SHA'] = 'abcdef0123456789'
ENV['IOS_USES_NON_EXEMPT_ENCRYPTION'] = 'false'
lanes.fetch(:beta).call
beta = sent.last
raise 'Beta must use the reviewed encryption declaration' unless beta[:uses_non_exempt_encryption] == false
raise 'Beta may submit external review' unless beta[:submit_beta_review] == false && beta[:distribute_external] == false
raise 'Beta must wait and select the internal group' unless beta[:skip_waiting_for_build_processing] == false && beta[:groups] == ['Brevia 内部测试']
ENV['RELEASE_VERSION'] = '1.0.0'
ENV['RELEASE_BUILD'] = '123'
lanes.fetch(:promote).call
release = sent.last
raise 'Production must reuse the tested binary and hold release' unless release[:skip_binary_upload] && release[:submit_for_review] && release[:automatic_release] == false && release[:build_number] == '123'
ENV['RELEASE_BUILD'] = 'latest'
begin
  lanes.fetch(:promote).call
  raise 'Invalid build was accepted'
rescue ArgumentError
  raise 'Invalid input triggered submission' unless sent.length == 2
end
ENV['IOS_USES_NON_EXEMPT_ENCRYPTION'] = 'true'
lanes.fetch(:beta).call
raise 'Non-exempt encryption was lost' unless sent.last[:uses_non_exempt_encryption] == true
[nil, '', 'FALSE', 'unknown'].each do |value|
  ENV['IOS_USES_NON_EXEMPT_ENCRYPTION'] = value
  before = sent.length
  begin
    lanes.fetch(:beta).call
    raise 'An unreviewed encryption declaration was accepted'
  rescue ArgumentError
    raise 'Invalid encryption declaration triggered upload' unless sent.length == before
  end
end
puts 'Release safeguards passed'

# 只读状态通道不触发上传或送审，空账号状态仍有可解析回执。
require 'json'
require 'stringio'
module Spaceship
  module ConnectAPI
    class App
      def self.find(identifier)
        raise 'Unexpected app' unless identifier == 'com.brevia.breviaMobile'
        app = Object.new
        app.define_singleton_method(:get_app_store_versions) { |**_| [] }
        app.define_singleton_method(:get_review_submissions) { |**_| [] }
        app
      end
    end
  end
end
before = sent.length
original_stdout = $stdout
begin
  $stdout = StringIO.new
  lanes.fetch(:store_status).call
  receipt = JSON.parse($stdout.string.split('APP_STORE_STATUS=', 2).last)
  raise 'Unreadable status receipt' unless receipt == { 'versions' => [], 'submissions' => [] }
  raise 'Status channel performed a write' unless sent.length == before
ensure
  $stdout = original_stdout
end
puts 'Read-only App Store status passed'
