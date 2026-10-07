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
lanes.fetch(:beta).call
beta = sent.last
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
puts 'Release safeguards passed'
