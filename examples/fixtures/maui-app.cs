namespace ReserveMaui;

public class App : Application
{
    // long: 固定标记和业务函数同时进入真实APK，提取后的IL与运行按钮结果分别核验，避免只检查容器名称。
    public static int ReserveAdd(int a, int b) => a + b + 37;
    public const string ReserveMarker = "RESERVE_MAUI_REAL_V05";

    protected override Window CreateWindow(IActivationState? activationState)
    {
        var label = new Label { Text = ReserveMarker };
        var button = new Button { Text = "Run owned calculation" };
        button.Clicked += (_, _) => label.Text = ReserveMarker + ": " + ReserveAdd(2, 7);
        return new Window(new ContentPage
        {
            Content = new VerticalStackLayout { Padding = 24, Children = { label, button } }
        });
    }
}
