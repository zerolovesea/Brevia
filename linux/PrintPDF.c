// Print the self-contained meeting export in a web view without the application
// bridge.
#include <glib/gstdio.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <webkit2/webkit2.h>

static const char *output_path;
static gboolean finished;
static gboolean timeout(gpointer unused) {
  (void)unused;
  gtk_main_quit();
  return G_SOURCE_REMOVE;
}
static void printed(WebKitPrintOperation *op, gpointer unused) {
  (void)op;
  (void)unused;
  finished = TRUE;
  gtk_main_quit();
}
static void load_changed(WebKitWebView *view, WebKitLoadEvent event,
                         gpointer unused) {
  (void)unused;
  if (event != WEBKIT_LOAD_FINISHED)
    return;
  WebKitPrintOperation *operation = webkit_print_operation_new(view);
  GtkPrintSettings *settings = gtk_print_settings_new();
  gchar *uri = g_filename_to_uri(output_path, NULL, NULL);
  gtk_print_settings_set_printer(settings, "Print to File");
  gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_FILE_FORMAT,
                         "pdf");
  gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, uri);
  webkit_print_operation_set_print_settings(operation, settings);
  g_signal_connect(operation, "finished", G_CALLBACK(printed), NULL);
  webkit_print_operation_print(operation);
  g_free(uri);
  g_object_unref(settings);
}
int main(int argc, char **argv) {
  if (argc != 2 || !g_path_is_absolute(argv[1]) ||
      !g_str_has_suffix(argv[1], ".print.html"))
    return 1;
  gchar *source = NULL;
  if (!g_file_get_contents(argv[1], &source, NULL, NULL))
    return 1;
  FILE *pdf = fdopen(dup(STDOUT_FILENO), "wb");
  if (!pdf || dup2(STDERR_FILENO, STDOUT_FILENO) < 0)
    return 1;
  gtk_init(&argc, &argv);
  gchar *directory = g_dir_make_tmp("brevia-print-XXXXXX", NULL);
  if (!directory)
    return 1;
  gchar *filename = g_build_filename(directory, "meeting.pdf", NULL);
  output_path = filename;
  WebKitWebContext *context = webkit_web_context_new_ephemeral();
  WebKitWebView *view =
      WEBKIT_WEB_VIEW(webkit_web_view_new_with_context(context));
  webkit_settings_set_enable_javascript(webkit_web_view_get_settings(view),
                                        FALSE);
  gchar *html = g_strconcat(
      "<meta http-equiv='Content-Security-Policy' content=\"default-src "
      "'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">",
      source, NULL);
  g_signal_connect(view, "load-changed", G_CALLBACK(load_changed), NULL);
  webkit_web_view_load_html(view, html, NULL);
  g_timeout_add_seconds(60, timeout, NULL);
  gtk_main();
  gchar *bytes = NULL;
  gsize length = 0;
  gboolean ok = finished &&
                g_file_get_contents(filename, &bytes, &length, NULL) &&
                length >= 5 && !memcmp(bytes, "%PDF-", 5) &&
                fwrite(bytes, 1, length, pdf) == length && fclose(pdf) == 0;
  g_remove(filename);
  g_rmdir(directory);
  return ok ? 0 : 1;
}
