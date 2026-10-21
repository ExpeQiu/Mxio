# Velxio CLI

标准命令行接口：查元件、读写任意 `.vlx`、Kit 补缺件、VAP/Studio 查询、写代码、编译、SPICE 断言。不是某一个示例的脚本，而是整套 Velxio 的 Agent/终端入口。画布仍在 Web 编辑器。`./start.sh` 管进程，`velxio doctor` 只探活。

## 安装

```bash
cd cli && npm install
./bin/velxio --help
```

## 验收

```bash
./scripts/verify.sh
```

## 配置

见 `.env.example`。`VELXIO_API_URL` 默认 `http://127.0.0.1:8001`。`--demo` 不打真实编译后端。

## 文档

仓内 [`guide/cli.md`](../guide/cli.md)、[`ADR/ADR-011-cli.md`](../ADR/ADR-011-cli.md)。
