; Jenn Desktop Input — Alt+Space → отправка текста на сервер
; Requires AutoHotkey v2: https://www.autohotkey.com
; Запуск: двойной клик по файлу или автозагрузка

#SingleInstance Force
#NoTrayIcon

JENN_URL := "http://localhost:3000"
JENN_TOKEN := "test-token-550e8400"

!Space:: {
    myGui := Gui("+AlwaysOnTop +ToolWindow -Caption +Border", "Jenn")
    myGui.BackColor := "2d2d2d"
    myGui.SetFont("s14 cWhite", "Segoe UI")
    myGui.MarginX := 16
    myGui.MarginY := 12

    edit := myGui.Add("Edit", "w440 h30 -WantReturn")
    edit.Focus()

    edit.OnEvent("KeyPress", (*) => Submit(edit, myGui))

    myGui.OnEvent("Escape", (*) => myGui.Destroy())

    MonitorGetWorkArea(0, &, &, &Right, &)
    myGui.Show("x" (Right - 472) / 2 " y100")
}

Submit(edit, myGui) {
    text := edit.Value
    if (text = "")
        return

    myGui.Destroy()

    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", JENN_URL "/v1/message", false)
        req.SetRequestHeader("Authorization", "Bearer " JENN_TOKEN)
        req.SetRequestHeader("Content-Type", "application/json")

        body := '{"source":"desktop","text":"' . StrReplace(text, '"', '\"') . '","user":{"id":"local","name":"Desktop User"}}'
        req.Send(body)

        if (req.Status = 201) {
            TrayTip "Jenn OK", text, 1
        } else {
            TrayTip "Jenn ERR", req.Status ": " req.ResponseText, 3
        }
    } catch as err {
        TrayTip "Jenn ERR", err.Message, 3
    }
}
