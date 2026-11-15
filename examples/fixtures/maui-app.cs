namespace ReserveMaui;

public class App : Application
{
    // long: 固定标记和业务函数同时进入真实APK，提取后的IL与运行按钮结果分别核验，避免只检查容器名称。
    public static int ReserveAdd(int a, int b) => a + b + 37;
    // long: 实例方法和字符串参数进入同一自有APK，用于验证托管签名/调用恢复不只覆盖静态整数函数。
    public int InstanceAdd(int a, int b) => a + b + 41;
    public string Normalize(string value) => value.Trim().ToUpperInvariant();
    public bool IsPositive(int value) => value > 0;
    public const string ReserveMarker = "RESERVE_MAUI_REAL_V05";

    protected override Window CreateWindow(IActivationState? activationState)
    {
        var label = new Label { Text = ReserveMarker };
        var button = new Button { Text = "Run owned calculation" };
        button.Clicked += (_, _) => label.Text = ReserveMarker + ": " + ReserveAdd(2, 7) + ":" + InstanceAdd(2, 7) + ":" + Normalize("maui") + ":" + IsPositive(7);
        return new Window(new ContentPage
        {
            Content = new VerticalStackLayout { Padding = 24, Children = { label, button } }
        });
    }
}
