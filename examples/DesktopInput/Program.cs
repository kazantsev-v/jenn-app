using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace JennDesktop;

static class Program
{
    [DllImport("user32.dll")]
    static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    const int HOTKEY_ID = 1;
    const uint MOD_ALT = 1;
    const uint MOD_CONTROL = 2;
    const uint MOD_SHIFT = 4;
    const uint MOD_WIN = 8;
    const int WM_HOTKEY = 0x0312;

    static readonly HttpClient http = new();
    static InputForm? inputForm;
    static NotifyIcon? trayIcon;
    static AppConfig config = new();

    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();

        config = AppConfig.Load();
        if (string.IsNullOrWhiteSpace(config.Token) || string.IsNullOrWhiteSpace(config.ServerUrl))
        {
            config = AppConfig.ShowSetupDialog();
            if (config == null) return;
            config.Save();
        }

        inputForm = new InputForm();
        trayIcon = CreateTrayIcon();
        RegisterHotKey(inputForm.Handle, HOTKEY_ID, config.HotkeyModifier, config.HotkeyKey);

        Application.Run(inputForm);
    }

    static void ReregisterHotkey()
    {
        UnregisterHotKey(inputForm!.Handle, HOTKEY_ID);
        RegisterHotKey(inputForm.Handle, HOTKEY_ID, config.HotkeyModifier, config.HotkeyKey);
    }

    class InputForm : Form
    {
        TextBox textBox;
        Label placeholder;

        public InputForm()
        {
            WindowState = FormWindowState.Minimized;
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;

            BackColor = Color.FromArgb(45, 45, 45);
            Size = new Size(480, 48);
            TopMost = true;

            textBox = new TextBox
            {
                Location = new Point(12, 10),
                Size = new Size(456, 30),
                Font = new Font("Segoe UI", 16),
                BackColor = Color.FromArgb(45, 45, 45),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.None,
                TabStop = false
            };

            placeholder = new Label
            {
                Text = "Ask Jenn anything...",
                Location = new Point(14, 11),
                Size = new Size(400, 28),
                Font = new Font("Segoe UI", 16),
                ForeColor = Color.Gray,
                BackColor = Color.Transparent
            };

            textBox.TextChanged += (_, _) => placeholder.Visible = textBox.Text.Length == 0;
            textBox.KeyDown += OnKeyDown;
            textBox.LostFocus += (_, _) => Hide();

            Controls.Add(textBox);
            Controls.Add(placeholder);

            Paint += (_, e) =>
            {
                using var pen = new Pen(Color.FromArgb(100, 120, 200), 2);
                e.Graphics.DrawRectangle(pen, 1, 1, Width - 3, Height - 3);
            };
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID)
            {
                ShowWindow();
            }
            base.WndProc(ref m);
        }

        void ShowWindow()
        {
            var screen = Screen.PrimaryScreen!.WorkingArea;
            Location = new Point((screen.Width - Width) / 2, screen.Height / 4);
            textBox.Text = "";
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
            textBox.Focus();
        }

        async void OnKeyDown(object? sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                Hide();
                e.SuppressKeyPress = true;
                return;
            }

            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;

            var text = textBox.Text.Trim();
            if (text.Length == 0) { Hide(); return; }

            Hide();

            try
            {
                var payload = new
                {
                    source = string.IsNullOrWhiteSpace(config.SourceName) ? "desktop" : config.SourceName,
                    text,
                    user = new { id = "local", name = Environment.UserName }
                };

                var req = new HttpRequestMessage(HttpMethod.Post, $"{config.ServerUrl}/v1/message");
                req.Headers.Add("Authorization", $"Bearer {config.Token}");
                req.Content = JsonContent.Create(payload);

                var res = await http.SendAsync(req);
                var json = await res.Content.ReadAsStringAsync();

                if (res.IsSuccessStatusCode)
                    ShowBalloon("Jenn \u2713", $"Sent: {text}", ToolTipIcon.Info);
                else
                {
                    var err = JsonSerializer.Deserialize<JsonElement>(json);
                    ShowBalloon("Jenn \u2717", err.GetProperty("message").GetString() ?? "Unknown error", ToolTipIcon.Error);
                }
            }
            catch (Exception ex)
            {
                ShowBalloon("Jenn \u2717", ex.Message, ToolTipIcon.Error);
            }
        }
    }

    static void ShowBalloon(string title, string text, ToolTipIcon icon)
    {
        trayIcon?.ShowBalloonTip(3000, title, text, icon);
    }

    static NotifyIcon CreateTrayIcon()
    {
        var icon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Jenn Desktop Input",
            Visible = true,
            ContextMenuStrip = new ContextMenuStrip()
        };
        icon.ContextMenuStrip.Items.Add("Settings", null, (_, _) =>
        {
            var updated = AppConfig.ShowSetupDialog();
            if (updated != null)
            {
                config = updated;
                config.Save();
                ReregisterHotkey();
                ShowBalloon("Jenn", "Settings saved", ToolTipIcon.Info);
            }
        });
        icon.ContextMenuStrip.Items.Add(new ToolStripSeparator());
        icon.ContextMenuStrip.Items.Add("Exit", null, (_, _) =>
        {
            UnregisterHotKey(inputForm!.Handle, HOTKEY_ID);
            trayIcon?.Dispose();
            Application.Exit();
        });
        return icon;
    }

    internal static string ModifierDisplay(uint mod)
    {
        var parts = new List<string>();
        if ((mod & MOD_ALT) != 0) parts.Add("Alt");
        if ((mod & MOD_CONTROL) != 0) parts.Add("Ctrl");
        if ((mod & MOD_SHIFT) != 0) parts.Add("Shift");
        if ((mod & MOD_WIN) != 0) parts.Add("Win");
        return parts.Count > 0 ? string.Join(" + ", parts) : "";
    }

    internal static string KeyDisplay(uint vk)
    {
        if (vk == 0x20) return "Space";
        if (vk >= 0x30 && vk <= 0x39) return ((char)vk).ToString();
        if (vk >= 0x41 && vk <= 0x5A) return ((char)vk).ToString();
        if (vk >= 0x70 && vk <= 0x7B) return $"F{vk - 0x6F}";
        if (vk == 0x0D) return "Enter";
        if (vk == 0x09) return "Tab";
        if (vk == 0x1B) return "Esc";
        if (vk == 0x2D) return "Insert";
        if (vk == 0x2E) return "Delete";
        if (vk == 0x24) return "Home";
        if (vk == 0x23) return "End";
        if (vk == 0x21) return "PageUp";
        if (vk == 0x22) return "PageDown";
        return $"0x{vk:X2}";
    }

    internal static string HotkeyDisplay(uint mod, uint vk)
    {
        var m = ModifierDisplay(mod);
        var k = KeyDisplay(vk);
        return m.Length > 0 ? $"{m} + {k}" : k;
    }
}

class AppConfig
{
    public string Token { get; set; } = "";
    public string ServerUrl { get; set; } = "";
    public string SourceName { get; set; } = "";
    public uint HotkeyModifier { get; set; } = 1;
    public uint HotkeyKey { get; set; } = 0x20;

    static string ConfigPath => Path.Combine(
        Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location) ?? ".",
        "config.json");

    public static AppConfig Load()
    {
        try
        {
            var path = ConfigPath;
            if (!File.Exists(path)) return new AppConfig();
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<AppConfig>(json) ?? new AppConfig();
        }
        catch
        {
            return new AppConfig();
        }
    }

    public void Save()
    {
        try
        {
            var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(ConfigPath, json);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to save config: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    public static AppConfig? ShowSetupDialog()
    {
        var form = new Form
        {
            Width = 460,
            Height = 440,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            StartPosition = FormStartPosition.CenterScreen,
            Text = "Jenn Desktop Setup",
            BackColor = Color.FromArgb(30, 30, 30),
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 12)
        };

        var existing = Load();
        bool hasExisting = !string.IsNullOrWhiteSpace(existing.Token);

        var lblToken = new Label { Text = "Source Token:", Location = new Point(20, 22), Size = new Size(400, 20), ForeColor = Color.Gray };
        var txtToken = new TextBox
        {
            Text = existing.Token,
            Location = new Point(20, 46),
            Size = new Size(400, 28),
            BackColor = Color.FromArgb(50, 50, 50),
            ForeColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Segoe UI", 11)
        };

        var lblUrl = new Label { Text = "Server URL:", Location = new Point(20, 88), Size = new Size(400, 20), ForeColor = Color.Gray };
        var txtUrl = new TextBox
        {
            Text = string.IsNullOrWhiteSpace(existing.ServerUrl) ? "http://localhost:3000" : existing.ServerUrl,
            Location = new Point(20, 112),
            Size = new Size(400, 28),
            BackColor = Color.FromArgb(50, 50, 50),
            ForeColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Segoe UI", 11)
        };

        var lblSource = new Label { Text = "Source Name:", Location = new Point(20, 154), Size = new Size(400, 20), ForeColor = Color.Gray };
        var txtSource = new TextBox
        {
            Text = string.IsNullOrWhiteSpace(existing.SourceName) ? "desktop" : existing.SourceName,
            Location = new Point(20, 178),
            Size = new Size(400, 28),
            BackColor = Color.FromArgb(50, 50, 50),
            ForeColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Segoe UI", 11)
        };

        var lblHotkey = new Label { Text = "Hotkey:", Location = new Point(20, 220), Size = new Size(400, 20), ForeColor = Color.Gray };

        uint capturedMod = existing.HotkeyModifier;
        uint capturedKey = existing.HotkeyKey;
        bool isCapturing = false;

        var txtHotkey = new TextBox
        {
            Text = Program.HotkeyDisplay(existing.HotkeyModifier, existing.HotkeyKey),
            Location = new Point(20, 244),
            Size = new Size(400, 28),
            BackColor = Color.FromArgb(50, 50, 50),
            ForeColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Segoe UI", 11),
            ReadOnly = true,
            Cursor = Cursors.Hand,
            TextAlign = HorizontalAlignment.Center
        };

        txtHotkey.Enter += (_, _) =>
        {
            isCapturing = true;
            txtHotkey.Text = "Press key combination...";
            txtHotkey.ForeColor = Color.Gray;
        };

        txtHotkey.KeyDown += (_, e) =>
        {
            if (!isCapturing) return;
            e.SuppressKeyPress = true;

            if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Escape)
            {
                isCapturing = false;
                txtHotkey.ForeColor = Color.White;
                txtHotkey.Text = Program.HotkeyDisplay(capturedMod, capturedKey);
                form.Focus();
                return;
            }

            uint mod = 0;
            if (e.Alt) mod |= 1;
            if (e.Control) mod |= 2;
            if (e.Shift) mod |= 4;

            var key = (uint)e.KeyCode;
            if (key >= 0x10 && key <= 0x12) return;

            if (mod == 0) return;

            capturedMod = mod;
            capturedKey = key;
            isCapturing = false;
            txtHotkey.ForeColor = Color.White;
            txtHotkey.Text = Program.HotkeyDisplay(capturedMod, capturedKey);
            form.Focus();
        };

        txtHotkey.Leave += (_, _) =>
        {
            isCapturing = false;
            txtHotkey.ForeColor = Color.White;
            txtHotkey.Text = Program.HotkeyDisplay(capturedMod, capturedKey);
        };

        var btnSave = new Button
        {
            Text = hasExisting ? "Save" : "Connect",
            Location = new Point(20, 300),
            Size = new Size(100, 36),
            BackColor = Color.FromArgb(88, 166, 255),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 11, FontStyle.Bold),
            Cursor = Cursors.Hand
        };

        var btnCancel = new Button
        {
            Text = "Cancel",
            Location = new Point(130, 300),
            Size = new Size(100, 36),
            BackColor = Color.FromArgb(60, 60, 60),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 11),
            Cursor = Cursors.Hand
        };

        var hintToken = new Label
        {
            Text = "\u24d8 Token из админки: Routes \u2192 Desktop Input \u2192 Copy",
            Location = new Point(20, 350),
            Size = new Size(420, 20),
            ForeColor = Color.FromArgb(139, 148, 158),
            Font = new Font("Segoe UI", 9)
        };

        var hintHotkey = new Label
        {
            Text = "\u24d8 Нажмите на поле hotkey, затем зажмите комбинацию клавиш",
            Location = new Point(20, 370),
            Size = new Size(420, 20),
            ForeColor = Color.FromArgb(139, 148, 158),
            Font = new Font("Segoe UI", 9)
        };

        AppConfig? result = null;

        btnSave.Click += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(txtToken.Text))
            {
                MessageBox.Show("Token is required", "Validation", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            result = new AppConfig
            {
                Token = txtToken.Text.Trim(),
                ServerUrl = txtUrl.Text.Trim().TrimEnd('/'),
                SourceName = txtSource.Text.Trim(),
                HotkeyModifier = capturedMod,
                HotkeyKey = capturedKey
            };
            form.Close();
        };

        btnCancel.Click += (_, _) => { result = null; form.Close(); };

        form.Controls.AddRange(new Control[] {
            lblToken, txtToken,
            lblUrl, txtUrl,
            lblSource, txtSource,
            lblHotkey, txtHotkey,
            btnSave, btnCancel,
            hintToken, hintHotkey
        });
        form.ShowDialog();

        return result;
    }
}
