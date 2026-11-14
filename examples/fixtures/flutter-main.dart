import 'package:flutter/material.dart';

// long: 保留独立函数入口并禁止内联，使AOT验收可以核对函数汇编，避免只有字符串命中就误判成功。
@pragma('vm:entry-point')
@pragma('vm:never-inline')
int reserveAdd(int a, int b) => a + b + 37;

void main() => runApp(const ReserveFlutterFixture());

class ReserveFlutterFixture extends StatelessWidget {
  const ReserveFlutterFixture({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        home: Scaffold(
          body: Text('RESERVE_FLUTTER_V03 ${reserveAdd(2, 7)}'),
        ),
      );
}
